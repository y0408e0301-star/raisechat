package com.example.raisechat.workspace;

import java.io.Serializable;
import java.time.Instant;

import org.jspecify.annotations.Nullable;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

// ワークスペースのメンバー（データ設計書 4.3）
@Entity
@Table(name = "workspace_members")
@IdClass(WorkspaceMember.Key.class)
public class WorkspaceMember {

	public enum Role {

		OWNER, MEMBER

	}

	@Id
	private long workspaceId;

	@Id
	private long userId;

	@Column(nullable = false, updatable = false)
	@Enumerated(EnumType.STRING)
	private Role role;

	// 最後に開いた会話（W-4）。会話が消されたらデータベースがなしにする
	private @Nullable Long lastOpenedConversationId;

	@Column(nullable = false)
	private Instant joinedAt;

	protected WorkspaceMember() {
		this(0, 0, Role.MEMBER, Instant.EPOCH);
	}

	public WorkspaceMember(long workspaceId, long userId, Role role, Instant now) {
		this.workspaceId = workspaceId;
		this.userId = userId;
		this.role = role;
		this.joinedAt = now;
	}

	// 会話を開いたときに記録する（FN-03 5 章の 4）
	public void openConversation(long conversationId) {
		this.lastOpenedConversationId = conversationId;
	}

	public long getWorkspaceId() {
		return this.workspaceId;
	}

	public long getUserId() {
		return this.userId;
	}

	public Role getRole() {
		return this.role;
	}

	public @Nullable Long getLastOpenedConversationId() {
		return this.lastOpenedConversationId;
	}

	// 主キー（workspace_id, user_id）
	public record Key(long workspaceId, long userId) implements Serializable {
	}

}
