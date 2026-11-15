package com.example.raisechat.mention;

import java.io.Serializable;
import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

// メンション（データ設計書 4.10）。読んだか（is_read）は、既読の記録（FN-14。1-15）で進める
@Entity
@Table(name = "mentions")
@IdClass(Mention.Key.class)
class Mention {

	@Id
	private long messageId;

	@Id
	private long userId;

	@Column(nullable = false)
	private boolean isRead;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	protected Mention() {
		this(0, 0, Instant.EPOCH);
	}

	Mention(long messageId, long userId, Instant now) {
		this.messageId = messageId;
		this.userId = userId;
		this.isRead = false;
		this.createdAt = now;
	}

	long getUserId() {
		return this.userId;
	}

	// 主キー（message_id, user_id）
	record Key(long messageId, long userId) implements Serializable {
	}

}
