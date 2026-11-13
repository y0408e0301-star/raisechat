package com.example.raisechat.workspace;

import java.time.Instant;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.user.UserSummary;

// ワークスペースのメンバー（FN-05 6 章の MemberView）。UserSummary に役割と参加日時を足したもの
record MemberView(String username, String displayName, @Nullable String avatarUrl, @Nullable String statusEmoji,
		@Nullable String statusText, WorkspaceMember.Role role, Instant joinedAt) {

	static MemberView of(UserSummary user, WorkspaceMember member) {
		return new MemberView(user.username(), user.displayName(), user.avatarUrl(), user.statusEmoji(),
				user.statusText(), member.getRole(), member.getJoinedAt());
	}

}
