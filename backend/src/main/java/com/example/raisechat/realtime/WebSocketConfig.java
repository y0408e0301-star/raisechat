package com.example.raisechat.realtime;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;

// リアルタイムの通知（機能定義書 4 章）。WebSocket（/ws）の上で STOMP を使い、配信はメモリの中の simple broker で行う
// （API のタスクは 1 つなので外の配信の仕組みは要らない。技術スタック定義書）。
// 画面からは購読（SUBSCRIBE）だけを受け付け、メッセージの送信などは API で行う（WebSocketSecurityConfig）
@Configuration(proxyBeanMethods = false)
@EnableWebSocketMessageBroker
@EnableConfigurationProperties(RealtimeProperties.class)
class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

	// 画面とサーバーが合図（ハートビート）を送り合う間隔（機能定義書 4.1）
	static final long HEARTBEAT_MILLIS = 20_000;

	private final RealtimeProperties properties;

	private final WebSocketSessions sessions;

	private final TaskScheduler scheduler;

	// scheduler は、この設定から作られる WebSocket 用のもの。作る前に要るので @Lazy で受け取る（Spring の説明書のやり方）
	WebSocketConfig(RealtimeProperties properties, WebSocketSessions sessions,
			@Lazy @Qualifier("messageBrokerTaskScheduler") TaskScheduler scheduler) {
		this.properties = properties;
		this.sessions = sessions;
		this.scheduler = scheduler;
	}

	// つなぐ URL。ログインの確かめ（Cookie の access_token）は SecurityConfig がつなぎ始め（HTTP）で行う。
	// Origin が本アプリの画面でなければ 403 にする（N-25）。Origin のないつなぎ方（ブラウザ以外）は、ほかのサイトから
	// 利用者になりすます攻撃にならないので通す（Spring の既定）
	@Override
	public void registerStompEndpoints(StompEndpointRegistry registry) {
		registry.addEndpoint("/ws").setAllowedOrigins(this.properties.origin());
	}

	@Override
	public void configureMessageBroker(MessageBrokerRegistry registry) {
		registry.enableSimpleBroker("/topic", "/queue")
			.setHeartbeatValue(new long[] { HEARTBEAT_MILLIS, HEARTBEAT_MILLIS })
			.setTaskScheduler(this.scheduler);
		registry.setUserDestinationPrefix("/user");
		// 1 人の画面には送った順に届ける。既定では送り出しが並行するので、続けて送った通知（返信の削除と親の件数、
		// 続けて変えたリアクションなど）の順が入れ替わり、古い状態が最後に出ることがある
		registry.setPreservePublishOrder(true);
	}

	// つないだ・切れたことを記録し、JWT の期限が来たら切る（WebSocketSessions）
	@Override
	public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
		registration.addDecoratorFactory(this.sessions::decorate);
	}

}
