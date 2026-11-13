package com.example.raisechat.conversation;

import java.time.Instant;

import org.jspecify.annotations.Nullable;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

// 会話（データ設計書 4.5）。チャンネルと DM を種類（type）で分けて持つ（データ設計書 方針 6）
@Entity
@Table(name = "conversations")
public class Conversation {

	public enum Type {

		CHANNEL, DM

	}

	public enum Visibility {

		PUBLIC, PRIVATE

	}

	// ワークスペースを作ったときにできるチャンネルの名前（W-3）
	static final String GENERAL_NAME = "general";

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private @Nullable Long id;

	@Column(nullable = false, updatable = false)
	private long workspaceId;

	@Column(nullable = false, updatable = false)
	@Enumerated(EnumType.STRING)
	private Type type;

	// チャンネルだけ。DM ではなし
	private @Nullable String name;

	private @Nullable String description;

	@Enumerated(EnumType.STRING)
	private @Nullable Visibility visibility;

	@Column(name = "is_general", nullable = false, updatable = false)
	private boolean general;

	// DM の 2 人（ID の小さい方・大きい方）。チャンネルではなし
	@Column(updatable = false)
	private @Nullable Long dmUserLow;

	@Column(updatable = false)
	private @Nullable Long dmUserHigh;

	@Column(nullable = false, updatable = false)
	private long createdBy;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	protected Conversation() {
		this(0, Type.CHANNEL, null, null, null, false, 0, Instant.EPOCH);
	}

	private Conversation(long workspaceId, Type type, @Nullable String name, @Nullable String description,
			@Nullable Visibility visibility, boolean general, long createdBy, Instant now) {
		this.workspaceId = workspaceId;
		this.type = type;
		this.name = name;
		this.description = description;
		this.visibility = visibility;
		this.general = general;
		this.createdBy = createdBy;
		this.createdAt = now;
	}

	// ワークスペースを作ったときの公開チャンネル general（W-3、FN-06）
	public static Conversation general(long workspaceId, long createdBy, Instant now) {
		return new Conversation(workspaceId, Type.CHANNEL, GENERAL_NAME, null, Visibility.PUBLIC, true, createdBy, now);
	}

	// チャンネル（CH-2）。名前・説明は確かめたもの（ChannelNames）
	static Conversation channel(long workspaceId, String name, @Nullable String description, Visibility visibility,
			long createdBy, Instant now) {
		return new Conversation(workspaceId, Type.CHANNEL, name, description, visibility, false, createdBy, now);
	}

	// DM の 2 人のうち、viewer でない方（FN-12）
	public long partnerOf(long viewer) {
		return (dmUserLow() == viewer) ? dmUserHigh() : dmUserLow();
	}

	long dmUserLow() {
		if (this.dmUserLow == null) {
			throw new IllegalStateException("DM ではありません");
		}
		return this.dmUserLow;
	}

	long dmUserHigh() {
		if (this.dmUserHigh == null) {
			throw new IllegalStateException("DM ではありません");
		}
		return this.dmUserHigh;
	}

	public long getId() {
		if (this.id == null) {
			throw new IllegalStateException("まだ保存していない会話です");
		}
		return this.id;
	}

	public long getWorkspaceId() {
		return this.workspaceId;
	}

	public Type getType() {
		return this.type;
	}

	public @Nullable String getName() {
		return this.name;
	}

	public @Nullable String getDescription() {
		return this.description;
	}

	public @Nullable Visibility getVisibility() {
		return this.visibility;
	}

	public boolean isGeneral() {
		return this.general;
	}

	public long getCreatedBy() {
		return this.createdBy;
	}

	public Instant getCreatedAt() {
		return this.createdAt;
	}

}
