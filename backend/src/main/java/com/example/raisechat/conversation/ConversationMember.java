package com.example.raisechat.conversation;

import java.io.Serializable;
import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

// 会話のメンバー（データ設計書 4.6）。最後に読んだメッセージ（last_read_message_id）は、メッセージを作る 1-4 から進める
@Entity
@Table(name = "conversation_members")
@IdClass(ConversationMember.Key.class)
public class ConversationMember {

	@Id
	private long conversationId;

	@Id
	private long userId;

	// 参加した時点の最新のメッセージの ID（なければ 0。BR-6）
	@Column(nullable = false)
	private long lastReadMessageId;

	@Column(nullable = false)
	private Instant joinedAt;

	protected ConversationMember() {
		this(0, 0, 0, Instant.EPOCH);
	}

	public ConversationMember(long conversationId, long userId, long lastReadMessageId, Instant now) {
		this.conversationId = conversationId;
		this.userId = userId;
		this.lastReadMessageId = lastReadMessageId;
		this.joinedAt = now;
	}

	public long getConversationId() {
		return this.conversationId;
	}

	public long getUserId() {
		return this.userId;
	}

	public long getLastReadMessageId() {
		return this.lastReadMessageId;
	}

	// 主キー（conversation_id, user_id）
	public record Key(long conversationId, long userId) implements Serializable {
	}

}
