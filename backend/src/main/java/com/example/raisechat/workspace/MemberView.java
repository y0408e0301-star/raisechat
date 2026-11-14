package com.example.raisechat.workspace;

import java.time.Instant;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.user.UserSummary;

// ワークスペースのメンバー（FN-05 6 章の MemberView）。UserSummary に、ステータスを消す時刻（G-16 の「（時刻）まで」）と
// 役割・参加日時を足したもの
record MemberView(String username, String displayName, @Nullable String avatarUrl, @Nullable String statusEmoji,
		@Nullable String statusText, @Nullable Instant statusExpiresAt, WorkspaceMember.Role role, Instant joinedAt) {

	static MemberView of(UserSummary user, @Nullable Instant statusExpiresAt, WorkspaceMember member) {
		return new MemberView(user.username(), user.displayName(), user.avatarUrl(), user.statusEmoji(),
				user.statusText(), statusExpiresAt, member.getRole(), member.getJoinedAt());
	}

}
