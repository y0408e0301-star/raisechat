package com.example.raisechat.profile;

import java.time.Instant;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.user.UserSummary;

// 自分のプロフィール（FN-02 6 章の MyProfile。G-10）。UserSummary にステータスを消す時刻を足したもの
record MyProfile(String username, String displayName, @Nullable String avatarUrl, @Nullable String statusEmoji,
		@Nullable String statusText, @Nullable Instant statusExpiresAt) {

	static MyProfile of(UserSummary user, @Nullable Instant statusExpiresAt) {
		return new MyProfile(user.username(), user.displayName(), user.avatarUrl(), user.statusEmoji(),
				user.statusText(), statusExpiresAt);
	}

}
