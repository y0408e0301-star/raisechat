package com.example.raisechat.reaction;

import java.io.Serializable;
import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

// リアクション（データ設計書 4.9）。付けた日時は、絵文字の並び順（最初に付けられた順）と付けた人の並び順に使う（RE-4・RE-5）
@Entity
@Table(name = "reactions")
@IdClass(Reaction.Key.class)
class Reaction {

	@Id
	private long messageId;

	@Id
	private long userId;

	@Id
	private String emoji;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	protected Reaction() {
		this(0, 0, "", Instant.EPOCH);
	}

	Reaction(long messageId, long userId, String emoji, Instant now) {
		this.messageId = messageId;
		this.userId = userId;
		this.emoji = emoji;
		this.createdAt = now;
	}

	// 主キー（message_id, user_id, emoji）
	record Key(long messageId, long userId, String emoji) implements Serializable {
	}

}
