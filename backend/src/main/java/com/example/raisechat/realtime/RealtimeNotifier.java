package com.example.raisechat.realtime;

import java.time.Clock;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

// リアルタイムの通知を送る（機能定義書 4.2・4.3）。
// トランザクションの中で呼ばれたら、コミットの後に送る（ロールバックしたものを送らない。FN-07 5 章の 6）。
// 通知は送ったときにつながっている人にだけ届く。届かなかった分は、画面がつなぎ直したときに API で取り直す（4.4）
@Component
public class RealtimeNotifier {

	private static final Logger log = LoggerFactory.getLogger(RealtimeNotifier.class);

	private final SimpMessagingTemplate messaging;

	private final Clock clock;

	RealtimeNotifier(SimpMessagingTemplate messaging, Clock clock) {
		this.messaging = messaging;
		this.clock = clock;
	}

	// /topic/conversations/{id}：その会話を見られる人（購読のときに確かめている）
	public void toConversation(RealtimeEvent.Type type, long workspaceId, long conversationId, Object payload) {
		afterCommit(() -> this.messaging.convertAndSend("/topic/conversations/" + conversationId,
				event(type, workspaceId, conversationId, payload)));
	}

	// /user/queue/events：本人だけ。宛先の名前は Spring Security の名前（JWT の sub。users.id）
	public void toUser(long userId, RealtimeEvent.Type type, long workspaceId, @Nullable Long conversationId,
			Object payload) {
		afterCommit(() -> this.messaging.convertAndSendToUser(String.valueOf(userId), "/queue/events",
				event(type, workspaceId, conversationId, payload)));
	}

	private RealtimeEvent event(RealtimeEvent.Type type, long workspaceId, @Nullable Long conversationId,
			Object payload) {
		return new RealtimeEvent(type, workspaceId, conversationId, payload, this.clock.instant());
	}

	private static void afterCommit(Runnable send) {
		if (!TransactionSynchronizationManager.isSynchronizationActive()) {
			sendQuietly(send);
			return;
		}
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {

			@Override
			public void afterCommit() {
				sendQuietly(send);
			}

		});
	}

	// 送れなくても、コミットした操作は成功として API の応答を返す（画面はつなぎ直したときに取り直す）
	private static void sendQuietly(Runnable send) {
		try {
			send.run();
		}
		catch (RuntimeException ex) {
			log.atError().setCause(ex).log("リアルタイムの通知を送れなかった");
		}
	}

}
