package com.example.raisechat.workspace;

import java.time.Duration;
import java.time.Instant;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.jspecify.annotations.Nullable;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

// 招待リンク（データ設計書 4.4）。取り消しても行は残し、作ってから 30 日たったら消す（BR-14）
@Entity
@Table(name = "invites")
class Invite {

	// 招待リンクを使える期間（FN-04 1 章）
	static final Duration LIFETIME = Duration.ofDays(7);

	enum Status {

		ACTIVE, EXPIRED, REVOKED

	}

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private @Nullable Long id;

	@Column(nullable = false, updatable = false)
	private long workspaceId;

	// 32 バイトの乱数の Base64URL は必ず 43 文字なので、データベースでは char(43)
	@Column(nullable = false, updatable = false, length = 43)
	@JdbcTypeCode(SqlTypes.CHAR)
	private String token;

	@Column(nullable = false, updatable = false)
	private Instant expiresAt;

	private @Nullable Instant revokedAt;

	@Column(nullable = false, updatable = false)
	private long createdBy;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	protected Invite() {
		this(0, "", 0, Instant.EPOCH);
	}

	Invite(long workspaceId, String token, long createdBy, Instant now) {
		this.workspaceId = workspaceId;
		this.token = token;
		this.createdBy = createdBy;
		this.createdAt = now;
		this.expiresAt = now.plus(LIFETIME);
	}

	// 取り消し済みなら何もしない（最初に取り消した日時を残す）
	void revoke(Instant now) {
		if (this.revokedAt == null) {
			this.revokedAt = now;
		}
	}

	// 取り消した日時があれば取り消し済み、期限を過ぎていれば期限切れ（FN-04 5 章の 7）
	Status status(Instant now) {
		if (this.revokedAt != null) {
			return Status.REVOKED;
		}
		return now.isBefore(this.expiresAt) ? Status.ACTIVE : Status.EXPIRED;
	}

	long getId() {
		if (this.id == null) {
			throw new IllegalStateException("まだ保存していない招待リンクです");
		}
		return this.id;
	}

	long getWorkspaceId() {
		return this.workspaceId;
	}

	String getToken() {
		return this.token;
	}

	Instant getExpiresAt() {
		return this.expiresAt;
	}

	@Nullable Instant getRevokedAt() {
		return this.revokedAt;
	}

	Instant getCreatedAt() {
		return this.createdAt;
	}

}
