package com.example.raisechat.realtime;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.broker.AbstractBrokerMessageHandler;
import org.springframework.messaging.simp.user.SimpSession;
import org.springframework.messaging.simp.user.SimpSubscription;
import org.springframework.messaging.simp.user.SimpUser;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.messaging.SessionUnsubscribeEvent;

// 会話を見られなくなった人の購読を、サーバー側で取り消す（機能定義書 4.5 の 2、N-15）。
// キック・退出・チャンネルの削除など（1-6・1-8）で、conversation.removed・workspace.removed を送るのと一緒に呼ぶ。
// 取り消せなかったときは、その人の接続をすべて切る（画面はつなぎ直し、見られない会話は購読できない）
@Component
public class SubscriptionRevoker {

	// 購読を取り消せずに接続を切るときの理由
	static final CloseStatus ACCESS_REVOKED = new CloseStatus(4003, "ACCESS_REVOKED");

	private static final Logger log = LoggerFactory.getLogger(SubscriptionRevoker.class);

	private final SimpUserRegistry users;

	private final AbstractBrokerMessageHandler broker;

	private final ApplicationEventPublisher events;

	private final WebSocketSessions sessions;

	SubscriptionRevoker(SimpUserRegistry users,
			@Qualifier("simpleBrokerMessageHandler") AbstractBrokerMessageHandler broker,
			ApplicationEventPublisher events, WebSocketSessions sessions) {
		this.users = users;
		this.broker = broker;
		this.events = events;
		this.sessions = sessions;
	}

	// トランザクションの中で呼ばれたら、コミットの後に取り消す（見られなくなったことが確かになってから）
	public void revoke(long userId, long conversationId) {
		if (!TransactionSynchronizationManager.isSynchronizationActive()) {
			revokeNow(userId, conversationId);
			return;
		}
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {

			@Override
			public void afterCommit() {
				revokeNow(userId, conversationId);
			}

		});
	}

	private void revokeNow(long userId, long conversationId) {
		try {
			SimpUser user = this.users.getUser(String.valueOf(userId));
			if (user == null) {
				return;
			}
			String destination = "/topic/conversations/" + conversationId;
			for (SimpSession session : user.getSessions()) {
				for (SimpSubscription subscription : session.getSubscriptions()) {
					if (destination.equals(subscription.getDestination())) {
						unsubscribe(session.getId(), subscription.getId());
						log.atInfo()
							.addKeyValue("event.action", "websocket-subscription-revoked")
							.addKeyValue(WebSocketSessions.USER_ID, String.valueOf(userId))
							.addKeyValue("websocket.session_id", session.getId())
							.addKeyValue("conversation.id", String.valueOf(conversationId))
							.log("WebSocket の購読を取り消した conversation={}", conversationId);
					}
				}
			}
		}
		catch (RuntimeException ex) {
			log.atWarn()
				.addKeyValue(WebSocketSessions.USER_ID, String.valueOf(userId))
				.addKeyValue("conversation.id", String.valueOf(conversationId))
				.setCause(ex)
				.log("WebSocket の購読を取り消せなかったので、接続をすべて切る");
			this.sessions.closeAll(userId, ACCESS_REVOKED);
		}
	}

	// 画面が UNSUBSCRIBE を送ったときと同じものを、配信の仕組み（simple broker）に直接渡す。
	// 購読の一覧（SimpUserRegistry）は購読の取り消しのイベントで直るので、それも出す
	private void unsubscribe(String sessionId, String subscriptionId) {
		SimpMessageHeaderAccessor accessor = SimpMessageHeaderAccessor.create(SimpMessageType.UNSUBSCRIBE);
		accessor.setSessionId(sessionId);
		accessor.setSubscriptionId(subscriptionId);
		accessor.setLeaveMutable(true);
		Message<byte[]> message = MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
		this.broker.handleMessage(message);
		this.events.publishEvent(new SessionUnsubscribeEvent(this, message));
	}

}
