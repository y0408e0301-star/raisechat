package com.example.raisechat.workspace;

import com.example.raisechat.unread.UnreadCounts;

// G-3 の 1 行（FN-03 6 章の WorkspaceSummary）。未読がある会話があるか（hasUnread）と、読んでいないメンションの合計（FN-14 NT-3）
record WorkspaceSummary(long id, String name, WorkspaceMember.Role role, boolean hasUnread, int mentionCount) {

	static WorkspaceSummary of(Workspace workspace, WorkspaceMember.Role role, UnreadCounts.WorkspaceCounts counts) {
		return new WorkspaceSummary(workspace.getId(), workspace.getName(), role, counts.hasUnread(),
				counts.mentionCount());
	}

}
