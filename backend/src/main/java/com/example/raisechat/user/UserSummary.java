package com.example.raisechat.user;

import java.time.Instant;

import org.jspecify.annotations.Nullable;

// ユーザーを出すときの形（機能定義書 3.5 の UserSummary）。自分の情報（FN-01）・オーナー・作った人などに使う。
// アバターの URL は 1-10 で署名付き URL を入れる
public record UserSummary(String username, String displayName, @Nullable String avatarUrl, @Nullable String statusEmoji,
		@Nullable String statusText) {

	public static UserSummary of(User user, Instant now) {
		return new UserSummary(user.getUsername(), user.getDisplayName(), null, user.currentStatusEmoji(now),
				user.currentStatusText(now));
	}

}
