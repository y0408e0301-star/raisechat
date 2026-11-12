package com.example.raisechat.realtime;

import java.io.IOException;
import java.security.Principal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;

// つないでいる WebSocket を覚えておく（機能定義書 4.1・4.5）。
// ・つないだ・切れたときにログを 1 行出す（基本設計書 2.3）
// ・つないだときの JWT の期限が来たら切る。画面は JWT を取り直してつなぎ直し、M-37 を出さない（4.1）
// ・購読を取り消せないときに、その人の接続をすべて切る（4.5、SubscriptionRevoker）
@Component
public class WebSocketSessions {

	// JWT の期限が来て切るときの理由。画面はこの番号を見て、M-37 を出さずに JWT を取り直す（4000〜4999 はアプリで決めてよい番号）
	public static final CloseStatus TOKEN_EXPIRED = new CloseStatus(4001, "TOKEN_EXPIRED");

	// WebSocket のログに付ける、接続した人（購読を取り消した人）の ID。API のリクエストの中で出すログには、
	// 操作した人の ID が user.id（MDC）で付くので、ぶつからないよう別の名前にする
	static final String USER_ID = "websocket.user_id";

	private static final Logger log = LoggerFactory.getLogger(WebSocketSessions.class);

	private final Map<String, Connection> connections = new ConcurrentHashMap<>();

	private final TaskScheduler scheduler;

	private final Clock clock;

	// scheduler は WebSocket の設定から作られるもの。WebSocketConfig がこの部品を使うので @Lazy で受け取る
	WebSocketSessions(@Lazy @Qualifier("messageBrokerTaskScheduler") TaskScheduler scheduler, Clock clock) {
		this.scheduler = scheduler;
		this.clock = clock;
	}

	WebSocketHandler decorate(WebSocketHandler handler) {
		return new WebSocketHandlerDecorator(handler) {

			@Override
			public void afterConnectionEstablished(WebSocketSession session) throws Exception {
				opened(session);
				super.afterConnectionEstablished(session);
			}

			@Override
			public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
				closed(session, status);
				super.afterConnectionClosed(session, status);
			}

		};
	}

	// その人の接続をすべて切る。画面はつなぎ直し、見られない会話は購読できない（4.5 の 2）
	public void closeAll(long userId, CloseStatus status) {
		String name = String.valueOf(userId);
		List<Connection> targets = this.connections.values().stream().filter((c) -> name.equals(c.userId())).toList();
		targets.forEach((c) -> close(c.session(), status));
	}

	private void opened(WebSocketSession session) {
		@Nullable String userId = userId(session);
		@Nullable ScheduledFuture<?> expiry = scheduleExpiry(session);
		this.connections.put(session.getId(), new Connection(session, userId, expiry));
		log.atInfo()
			.addKeyValue("event.action", "websocket-connected")
			.addKeyValue(WebSocketSessions.USER_ID, userId)
			.addKeyValue("websocket.session_id", session.getId())
			.log("WebSocket をつないだ");
	}

	private void closed(WebSocketSession session, CloseStatus status) {
		Connection connection = this.connections.remove(session.getId());
		ScheduledFuture<?> expiry = (connection != null) ? connection.expiry() : null;
		if (expiry != null) {
			expiry.cancel(false);
		}
		log.atInfo()
			.addKeyValue("event.action", "websocket-closed")
			.addKeyValue(WebSocketSessions.USER_ID, (connection != null) ? connection.userId() : userId(session))
			.addKeyValue("websocket.session_id", session.getId())
			.addKeyValue("websocket.close_code", status.getCode())
			.addKeyValue("websocket.close_reason", status.getReason())
			.log("WebSocket が切れた code={} reason={}", status.getCode(), status.getReason());
	}

	// JWT の期限に切る。時刻はアプリの Clock で求め（テストで進められる）、その差だけ待つ
	private @Nullable ScheduledFuture<?> scheduleExpiry(WebSocketSession session) {
		if (!(session.getPrincipal() instanceof JwtAuthenticationToken token)) {
			return null;
		}
		Instant expiresAt = token.getToken().getExpiresAt();
		if (expiresAt == null) {
			return null;
		}
		Duration left = Duration.between(this.clock.instant(), expiresAt);
		return this.scheduler.schedule(() -> close(session, TOKEN_EXPIRED), Instant.now().plus(left));
	}

	private static void close(WebSocketSession session, CloseStatus status) {
		try {
			session.close(status);
		}
		catch (IOException ex) {
			log.atWarn().addKeyValue("websocket.session_id", session.getId()).setCause(ex).log("WebSocket を切れなかった");
		}
	}

	// ユーザーの ID（users.id）。Spring Security の名前は JWT の sub
	private static @Nullable String userId(WebSocketSession session) {
		Principal principal = session.getPrincipal();
		return (principal != null) ? principal.getName() : null;
	}

	private record Connection(WebSocketSession session, @Nullable String userId, @Nullable ScheduledFuture<?> expiry) {
	}

}
