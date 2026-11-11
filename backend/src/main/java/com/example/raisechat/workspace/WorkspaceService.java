package com.example.raisechat.workspace;

import java.time.Clock;
import java.time.Instant;
import java.util.List;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.conversation.Conversation;
import com.example.raisechat.conversation.ConversationMember;
import com.example.raisechat.conversation.ConversationMemberRepository;
import com.example.raisechat.conversation.ConversationRepository;
import com.example.raisechat.user.User;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.user.UserSummary;

// ワークスペースの作成・一覧・詳細（機能定義書 FN-03）。削除はメンバー管理（開発計画書 1-8）で足す
@Service
class WorkspaceService {

	// 1 人がオーナーとして持てるワークスペースの数（データ要件定義書 2 章）
	static final int MAX_OWNED = 10;

	private final WorkspaceRepository workspaces;

	private final WorkspaceMemberRepository members;

	private final WorkspaceAccess access;

	private final ConversationRepository conversations;

	private final ConversationMemberRepository conversationMembers;

	private final UserRepository users;

	private final Clock clock;

	WorkspaceService(WorkspaceRepository workspaces, WorkspaceMemberRepository members, WorkspaceAccess access,
			ConversationRepository conversations, ConversationMemberRepository conversationMembers,
			UserRepository users, Clock clock) {
		this.workspaces = workspaces;
		this.members = members;
		this.access = access;
		this.conversations = conversations;
		this.conversationMembers = conversationMembers;
		this.users = users;
		this.clock = clock;
	}

	// G-3 の一覧（W-1）
	@Transactional(readOnly = true)
	List<WorkspaceSummary> list(long userId) {
		return this.workspaces.findAllByMember(userId)
			.stream()
			.map((m) -> WorkspaceSummary.of(m.workspace(), m.role()))
			.toList();
	}

	// ワークスペースを作り、自分をオーナーにし、general を作って自分を入れる（W-3、BR-4・BR-5）
	@Transactional
	WorkspaceDetail create(long userId, @Nullable String rawName) {
		String name = WorkspaceNames.valid(rawName);
		// 同じ人が同時に作っても 10 個を超えないよう、自分の行をロックしてから数える
		User owner = this.users.findByIdForUpdate(userId)
			.orElseThrow(() -> new ApiException(ErrorCode.UNAUTHENTICATED));
		if (this.workspaces.countByOwnerId(userId) >= MAX_OWNED) {
			throw new ApiException(ErrorCode.WORKSPACE_LIMIT);
		}
		Instant now = this.clock.instant();
		Workspace workspace = this.workspaces.save(new Workspace(name, userId, now));
		this.members.save(new WorkspaceMember(workspace.getId(), userId, WorkspaceMember.Role.OWNER, now));
		Conversation general = this.conversations.save(Conversation.general(workspace.getId(), userId, now));
		// まだメッセージがないので、最後に読んだメッセージは 0
		this.conversationMembers.save(new ConversationMember(general.getId(), userId, 0, now));
		return WorkspaceDetail.of(workspace, WorkspaceMember.Role.OWNER, UserSummary.of(owner, now), 1, general.getId(),
				null);
	}

	// G-5 を開くときの詳細。最後に開いた会話が見られなくなっていたら、なしとして返し、画面は general を開く（W-4）
	@Transactional(readOnly = true)
	WorkspaceDetail get(long userId, long workspaceId) {
		WorkspaceMember member = this.access.requireMember(userId, workspaceId);
		Workspace workspace = this.workspaces.findById(workspaceId)
			.orElseThrow(() -> new ApiException(ErrorCode.WORKSPACE_NOT_FOUND));
		User owner = this.users.findById(workspace.getOwnerId()).orElseThrow();
		long generalId = this.conversations.findGeneral(workspaceId).orElseThrow().getId();
		Long lastOpened = member.getLastOpenedConversationId();
		if (lastOpened != null && this.conversations.findVisible(userId, lastOpened).isEmpty()) {
			lastOpened = null;
		}
		return WorkspaceDetail.of(workspace, member.getRole(), UserSummary.of(owner, this.clock.instant()),
				this.members.countByWorkspaceId(workspaceId), generalId, lastOpened);
	}

}
