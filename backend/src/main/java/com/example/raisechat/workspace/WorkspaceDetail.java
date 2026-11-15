package com.example.raisechat.workspace;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.unread.UnreadCounts;
import com.example.raisechat.user.UserSummary;

// ワークスペースの詳細（FN-03 6 章の WorkspaceDetail）。WorkspaceSummary の項目に、オーナー・人数・general・最後に開いた会話を足したもの。
// 未読とメンションの件数は WorkspaceSummary と同じ（ヘッダーの「@」の件数。FN-14 NT-2）
record WorkspaceDetail(long id, String name, WorkspaceMember.Role role, boolean hasUnread, int mentionCount,
		UserSummary owner, long memberCount, long generalConversationId, @Nullable Long lastOpenedConversationId) {

	static WorkspaceDetail of(Workspace workspace, WorkspaceMember.Role role, UserSummary owner, long memberCount,
			long generalConversationId, @Nullable Long lastOpenedConversationId, UnreadCounts.WorkspaceCounts counts) {
		return new WorkspaceDetail(workspace.getId(), workspace.getName(), role, counts.hasUnread(),
				counts.mentionCount(), owner, memberCount, generalConversationId, lastOpenedConversationId);
	}

}
