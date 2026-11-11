package com.example.raisechat.workspace;

// G-3 の 1 行（FN-03 6 章の WorkspaceSummary）。
// 未読（hasUnread）とメンションの件数（mentionCount）は、通知（開発計画書 1-15）で数える。それまでは false・0
record WorkspaceSummary(long id, String name, WorkspaceMember.Role role, boolean hasUnread, int mentionCount) {

	static WorkspaceSummary of(Workspace workspace, WorkspaceMember.Role role) {
		return new WorkspaceSummary(workspace.getId(), workspace.getName(), role, false, 0);
	}

}
