package com.example.raisechat.workspace;

import org.springframework.stereotype.Component;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;

// ワークスペースのメンバーかを確かめる。入っていない・存在しないときは、どちらか分からないよう同じ 404 にする（W-8）
@Component
public class WorkspaceAccess {

	private final WorkspaceMemberRepository members;

	WorkspaceAccess(WorkspaceMemberRepository members) {
		this.members = members;
	}

	public WorkspaceMember requireMember(long userId, long workspaceId) {
		return this.members.findById(new WorkspaceMember.Key(workspaceId, userId))
			.orElseThrow(() -> new ApiException(ErrorCode.WORKSPACE_NOT_FOUND));
	}

}
