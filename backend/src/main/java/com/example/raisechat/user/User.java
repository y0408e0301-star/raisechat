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

// ユーザー（データ設計書 4.1）
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

	// S3 のキー（avatars/{UUID}.png）。ないときは頭文字の丸を出す（PF-3）
	private @Nullable String avatarKey;

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

	// 表示名を変える（PF-4）。値は確かめてから渡す
	public void changeDisplayName(String displayName, Instant now) {
		this.displayName = displayName;
		this.updatedAt = now;
	}

	// アバターを替える・外す（PF-2・PF-3）。前のキーを返すので、コミットの後で S3 から消す（BR-12）
	public @Nullable String changeAvatar(@Nullable String avatarKey, Instant now) {
		String previous = this.avatarKey;
		this.avatarKey = avatarKey;
		this.updatedAt = now;
		return previous;
	}

	// ステータスを変える（PF-5・PF-6）。値は確かめてから渡す。絵文字も文もなければ消す時刻もなくす
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

	public @Nullable String getAvatarKey() {
		return this.avatarKey;
	}

	// 消す時刻（G-10 で「（時刻）まで」を出す）。過ぎていれば null
	public @Nullable Instant currentStatusExpiresAt(Instant now) {
		return isStatusExpired(now) ? null : this.statusExpiresAt;
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
