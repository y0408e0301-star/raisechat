package com.example.raisechat.message;

import java.time.Instant;
import java.util.List;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.attachment.AttachmentView;
import com.example.raisechat.reaction.ReactionView;
import com.example.raisechat.user.UserSummary;

// メッセージ（機能定義書 3.5 の MessageView）。replyUsers は、返信のある親メッセージの、最後に返信した人から 3 人
// （画面設計書 2.9 の返信の件数の行のアバター）。メンション（mentions）は 1-14 で足す
record MessageView(long id, long conversationId, @Nullable Long parentId, UserSummary author, String body,
		List<AttachmentView> attachments, List<ReactionView> reactions, int replyCount, @Nullable Instant lastReplyAt,
		List<UserSummary> replyUsers, Instant createdAt, @Nullable Instant editedAt, boolean deleted, boolean mine,
		boolean canDelete) {

	// me：見ている人、owner：見ている人がそのワークスペースのオーナーか
	static MessageView of(Message m, UserSummary author, List<AttachmentView> attachments, List<ReactionView> reactions,
			List<UserSummary> replyUsers, long me, boolean owner) {
		boolean mine = m.getUserId() == me;
		// 「削除されました」の親メッセージは、もう消せない（本文がない）
		boolean canDelete = !m.isDeleted() && (mine || owner);
		return new MessageView(m.getId(), m.getConversationId(), m.getParentId(), author, m.getBody(),
				m.isDeleted() ? List.of() : attachments, m.isDeleted() ? List.of() : reactions, m.getReplyCount(),
				m.getLastReplyAt(), replyUsers, m.getCreatedAt(), m.getEditedAt(), m.isDeleted(), mine, canDelete);
	}

	// リアルタイムの通知で会話を見ている人みんなに送る形。見る人によって変わる mine・canDelete・reactedByMe は false にして送り、
	// 受け取った画面で直す（機能定義書 4.3）
	MessageView forEveryone() {
		return new MessageView(this.id, this.conversationId, this.parentId, this.author, this.body, this.attachments,
				this.reactions.stream().map(ReactionView::forEveryone).toList(), this.replyCount, this.lastReplyAt,
				this.replyUsers, this.createdAt, this.editedAt, this.deleted, false, false);
	}

}
