package com.example.raisechat.realtime;

import java.time.Instant;
import java.util.List;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.reaction.ReactionView;
import com.fasterxml.jackson.annotation.JsonValue;

// リアルタイムの通知の形（機能定義書 4.3）。OpenAPI では書けないので、機能定義書 4.3 の表を正とし、
// 画面の型（frontend の src/realtime/events.ts）にも同じ形を書く。実際に送った JSON は docs/api/realtime-events.json に書き出し、
// 画面のテストがそれを読めるかを確かめる（基本設計書 2.1）
public record RealtimeEvent(Type type, long workspaceId, @Nullable Long conversationId, Object payload,
		Instant sentAt) {

	// 通知の種類。足すときは機能定義書 4.3 の表と画面の型も直す
	public enum Type {

		// payload：MessageView（mine・canDelete は受け取った画面で直す）
		MESSAGE_CREATED("message.created"),

		// payload：MessageView（同上）
		MESSAGE_UPDATED("message.updated"),

		// payload：{"id","parentId"}
		MESSAGE_DELETED("message.deleted"),

		// payload：{"messageId","reactions"}（そのメッセージの reactions 全体。FN-10）
		REACTION_UPDATED("reaction.updated"),

		// 本人あて。payload：ConversationSummary（会話に参加した・招待された・作った。FN-06）
		CONVERSATION_UPDATED("conversation.updated"),

		// 本人あて。payload：{"conversationId","reason"}（会話から抜けた・チャンネルが削除された。FN-06）
		CONVERSATION_REMOVED("conversation.removed"),

		// 本人あて。payload：{"workspaceId","name","reason"}（キックされた・退出した・ワークスペースが削除された。FN-03・FN-05）
		WORKSPACE_REMOVED("workspace.removed"),

		// 本人あて。payload：{"workspaceId","hasUnread","mentionCount"}（G-3
		// の印とヘッダーの件数が変わったかもしれない。FN-14）
		WORKSPACE_UPDATED("workspace.updated"),

		// 本人あて。payload：{"kind","message","conversationName"}（メンションされた・DM
		// が届いた。ブラウザの通知に使う。FN-14 NT-7）
		NOTIFY("notify");

		private final String value;

		Type(String value) {
			this.value = value;
		}

		@JsonValue
		public String value() {
			return this.value;
		}

	}

	// message.deleted の payload
	public record MessageDeleted(long id, @Nullable Long parentId) {
	}

	// reaction.updated の payload
	public record ReactionUpdated(long messageId, List<ReactionView> reactions) {
	}

	// conversation.removed の payload
	public record ConversationRemoved(long conversationId, RemovedReason reason) {
	}

	// workspace.updated の payload
	public record WorkspaceUpdated(long workspaceId, boolean hasUnread, int mentionCount) {
	}

	// notify の payload。message は MessageView（mine・canDelete・reactedByMe は false）、
	// conversationName はチャンネルなら「#名前」、DM なら「DM」
	public record Notify(NotifyKind kind, Object message, String conversationName) {
	}

	// notify の種類。DM の中のメンションは DM として 1 つだけ送る（FN-14 5 章の 7）
	public enum NotifyKind {

		MENTION, DM

	}

	// workspace.removed の payload
	public record WorkspaceRemoved(long workspaceId, String name, WorkspaceRemovedReason reason) {
	}

	// ワークスペースから外れた理由（機能定義書 4.3）
	public enum WorkspaceRemovedReason {

		KICKED, LEFT, DELETED

	}

	// 会話を見られなくなった・サイドバーから消える理由（機能定義書 4.3）
	public enum RemovedReason {

		LEFT, DELETED

	}

}
