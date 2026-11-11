package com.example.raisechat.workspace;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.user.UserSummary;

// ワークスペースの詳細（FN-03 6 章の WorkspaceDetail）。WorkspaceSummary の項目に、オーナー・人数・general・最後に開いた会話を足したもの。
// 未読とメンションの件数は WorkspaceSummary と同じく 1-15 で数える
record WorkspaceDetail(long id, String name, WorkspaceMember.Role role, boolean hasUnread, int mentionCount,
		UserSummary owner, long memberCount, long generalConversationId, @Nullable Long lastOpenedConversationId) {

	static WorkspaceDetail of(Workspace workspace, WorkspaceMember.Role role, UserSummary owner, long memberCount,
			long generalConversationId, @Nullable Long lastOpenedConversationId) {
		return new WorkspaceDetail(workspace.getId(), workspace.getName(), role, false, 0, owner, memberCount,
				generalConversationId, lastOpenedConversationId);
	}

}
