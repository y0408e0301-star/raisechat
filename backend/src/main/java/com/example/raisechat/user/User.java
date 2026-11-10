package com.example.raisechat.user;

import java.time.Duration;
import java.time.Instant;

import org.jspecify.annotations.Nullable;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

// ユーザー（データ設計書 4.1）。アバターの置き場所（avatar_key）は、使い始める 1-10 で足す
@Entity
@Table(name = "users")
public class User {

	// ログインの失敗がこの回数に達したら、しばらくログインできなくする（A-7、BR-16）
	static final int MAX_FAILED_LOGINS = 5;

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private @Nullable Long id;

	// 登録したときの大文字・小文字のまま持つ。比べるときは小文字にする
	@Column(nullable = false, updatable = false)
	private String username;

	@Column(nullable = false)
	private String displayName;

	@Column(nullable = false)
	private String passwordHash;

	// ステータス（PF-5）。消す時刻を過ぎたら出さない（FN-02 5 章の 2）
	private @Nullable String statusEmoji;

	private @Nullable String statusText;

	private @Nullable Instant statusExpiresAt;

	@Column(nullable = false)
	private short failedLoginCount;

	private @Nullable Instant lockedUntil;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	@Column(nullable = false)
	private Instant updatedAt;

	protected User() {
		this("", "", "", Instant.EPOCH);
	}

	public User(String username, String displayName, String passwordHash, Instant now) {
		this.username = username;
		this.displayName = displayName;
		this.passwordHash = passwordHash;
		this.createdAt = now;
		this.updatedAt = now;
	}

	public boolean isLocked(Instant now) {
		return this.lockedUntil != null && this.lockedUntil.isAfter(now);
	}

	// ログインに失敗したときに呼ぶ。5 回目でロックをかけ、ロックが解けたらまた 5 回試せるよう回数を 0 に戻す（BR-16）
	public void recordFailedLogin(Instant now, Duration lockDuration) {
		this.failedLoginCount++;
		if (this.failedLoginCount >= MAX_FAILED_LOGINS) {
			this.lockedUntil = now.plus(lockDuration);
			this.failedLoginCount = 0;
		}
		this.updatedAt = now;
	}

	public void recordSuccessfulLogin(Instant now) {
		if (this.failedLoginCount != 0 || this.lockedUntil != null) {
			this.failedLoginCount = 0;
			this.lockedUntil = null;
			this.updatedAt = now;
		}
	}

	// ステータスを変える（PF-5・PF-6。1-10 で API から使う）。値は確かめてから渡す。絵文字も文もなければ消す時刻もなくす
	public void changeStatus(@Nullable String emoji, @Nullable String text, @Nullable Instant expiresAt, Instant now) {
		this.statusEmoji = emoji;
		this.statusText = text;
		this.statusExpiresAt = (emoji == null && text == null) ? null : expiresAt;
		this.updatedAt = now;
	}

	// いま出すステータス。消す時刻を過ぎていれば null（FN-02 5 章の 2。値は消さず、次に保存したときに上書きする）
	public @Nullable String currentStatusEmoji(Instant now) {
		return isStatusExpired(now) ? null : this.statusEmoji;
	}

	public @Nullable String currentStatusText(Instant now) {
		return isStatusExpired(now) ? null : this.statusText;
	}

	private boolean isStatusExpired(Instant now) {
		return this.statusExpiresAt != null && !this.statusExpiresAt.isAfter(now);
	}

	public long getId() {
		if (this.id == null) {
			throw new IllegalStateException("まだ保存していないユーザーです");
		}
		return this.id;
	}

	public String getUsername() {
		return this.username;
	}

	public String getDisplayName() {
		return this.displayName;
	}

	public Instant getCreatedAt() {
		return this.createdAt;
	}

	public String getPasswordHash() {
		return this.passwordHash;
	}

	public int getFailedLoginCount() {
		return this.failedLoginCount;
	}

	public @Nullable Instant getLockedUntil() {
		return this.lockedUntil;
	}

}
