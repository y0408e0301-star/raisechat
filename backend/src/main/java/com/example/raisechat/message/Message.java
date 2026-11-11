package com.example.raisechat.message;

import java.time.Instant;
import java.util.UUID;

import org.jspecify.annotations.Nullable;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

// メッセージ（データ設計書 4.7）。並び順は ID（FN-07 5 章の 1）。本文は Markdown 記法のまま持つ（5 章の 2）
@Entity
@Table(name = "messages")
public class Message {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private @Nullable Long id;

	@Column(nullable = false, updatable = false)
	private long conversationId;

	@Column(nullable = false, updatable = false)
	private long userId;

	// スレッドの返信のときだけ。返信はスレッド（開発計画書 1-12）で作る
	@Column(updatable = false)
	private @Nullable Long parentId;

	@Column(nullable = false, updatable = false)
	private UUID clientId;

	@Column(nullable = false)
	private String body;

	@Column(nullable = false)
	private int replyCount;

	private @Nullable Instant lastReplyAt;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	private @Nullable Instant editedAt;

	private @Nullable Instant deletedAt;

	protected Message() {
		this(0, 0, new UUID(0, 0), "", Instant.EPOCH);
	}

	public Message(long conversationId, long userId, UUID clientId, String body, Instant now) {
		this.conversationId = conversationId;
		this.userId = userId;
		this.clientId = clientId;
		this.body = body;
		this.createdAt = now;
	}

	// 本文を直す（MS-9）
	void edit(String body, Instant now) {
		this.body = body;
		this.editedAt = now;
	}

	// 返信を足したときに、親メッセージの件数と最後の返信の日時を直す（BR-7。スレッド（開発計画書 1-12）で使う）
	void replyAdded(Instant at) {
		this.replyCount++;
		this.lastReplyAt = at;
	}

	// 返信のある親メッセージを「削除されました」にする。本文を空にし、スレッドは残す（MS-11、BR-8）
	void markDeleted(Instant now) {
		this.body = "";
		this.deletedAt = now;
	}

	public long getId() {
		if (this.id == null) {
			throw new IllegalStateException("まだ保存していないメッセージです");
		}
		return this.id;
	}

	public long getConversationId() {
		return this.conversationId;
	}

	public long getUserId() {
		return this.userId;
	}

	public @Nullable Long getParentId() {
		return this.parentId;
	}

	public UUID getClientId() {
		return this.clientId;
	}

	public String getBody() {
		return this.body;
	}

	public int getReplyCount() {
		return this.replyCount;
	}

	public @Nullable Instant getLastReplyAt() {
		return this.lastReplyAt;
	}

	public Instant getCreatedAt() {
		return this.createdAt;
	}

	public @Nullable Instant getEditedAt() {
		return this.editedAt;
	}

	public boolean isDeleted() {
		return this.deletedAt != null;
	}

}
