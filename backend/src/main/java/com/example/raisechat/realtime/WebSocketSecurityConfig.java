package com.example.raisechat.realtime;

import java.util.function.Supplier;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.config.annotation.web.socket.EnableWebSocketSecurity;
import org.springframework.security.core.Authentication;
import org.springframework.security.messaging.access.intercept.MessageAuthorizationContext;
import org.springframework.security.messaging.access.intercept.MessageMatcherDelegatingAuthorizationManager;
import org.springframework.security.oauth2.jwt.Jwt;

import com.example.raisechat.common.CurrentUser;
import com.example.raisechat.conversation.ConversationRepository;

// STOMP のフレームごとの権限（機能定義書 4.1・4.2）。
// つなぐ人は、つなぎ始め（HTTP）で SecurityConfig がログインを確かめている。ここでは購読できる宛先を決める
@Configuration(proxyBeanMethods = false)
@EnableWebSocketSecurity
class WebSocketSecurityConfig {

	// 会話ごとの宛先。購読のときに、その会話を見られるかを確かめる（N-14）
	static final String CONVERSATION_TOPIC = "/topic/conversations/{conversationId}";

	// 本人あての宛先。つないだ人に自動で決まる（Spring のユーザーの宛先）
	static final String USER_EVENTS = "/user/queue/events";

	private static final Logger log = LoggerFactory.getLogger(WebSocketSecurityConfig.class);

	@Bean
	AuthorizationManager<Message<?>> messageAuthorizationManager(
			MessageMatcherDelegatingAuthorizationManager.Builder messages, ConversationRepository conversations) {
		return messages.simpTypeMatchers(SimpMessageType.CONNECT)
			.authenticated()
			.simpTypeMatchers(SimpMessageType.HEARTBEAT, SimpMessageType.UNSUBSCRIBE, SimpMessageType.DISCONNECT)
			.permitAll()
			.simpSubscribeDestMatchers(USER_EVENTS)
			.authenticated()
			.simpSubscribeDestMatchers(CONVERSATION_TOPIC)
			.access((authentication, context) -> canSubscribe(authentication, context, conversations))
			// 画面からの SEND（メッセージの送信）と、ほかの宛先の購読は受け付けない。送信は API で行う
			.anyMessage()
			.denyAll()
			.build();
	}

	// つなぐときの CSRF のトークンの確かめ（Spring Security の既定）は使わない。
	// WebSocket は、つなぎ始めの Origin を確かめてほかのサイトからのなりすましを防ぐ（N-25、WebSocketConfig）。
	// この名前の bean を置くと、既定の確かめ（XorCsrfChannelInterceptor）の代わりに使われる
	@Bean
	ChannelInterceptor csrfChannelInterceptor() {
		return new ChannelInterceptor() {
		};
	}

	// 見られない会話・ない会話・数字でない ID は断る。断られると、サーバーは ERROR を送って接続を切る（STOMP の決まり）
	private static AuthorizationDecision canSubscribe(Supplier<? extends Authentication> authentication,
			MessageAuthorizationContext<?> context, ConversationRepository conversations) {
		Authentication auth = authentication.get();
		if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt)) {
			return new AuthorizationDecision(false);
		}
		long me = CurrentUser.id(jwt);
		String raw = context.getVariables().get("conversationId");
		@Nullable Long conversationId = parseId(raw);
		boolean visible = conversationId != null && conversations.findVisible(me, conversationId).isPresent();
		if (!visible) {
			log.atInfo()
				.addKeyValue("event.action", "websocket-subscribe-denied")
				.addKeyValue(WebSocketSessions.USER_ID, String.valueOf(me))
				.addKeyValue("websocket.session_id",
						SimpMessageHeaderAccessor.getSessionId(context.getMessage().getHeaders()))
				.addKeyValue("conversation.id", raw)
				.log("WebSocket の購読を断った conversation={}", raw);
		}
		return new AuthorizationDecision(visible);
	}

	private static @Nullable Long parseId(@Nullable String raw) {
		if (raw == null || !raw.matches("[1-9][0-9]{0,17}")) {
			return null;
		}
		return Long.parseLong(raw);
	}

}
