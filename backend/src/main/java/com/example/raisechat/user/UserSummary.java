package com.example.raisechat.user;

import org.jspecify.annotations.Nullable;

// ユーザーを出すときの形（機能定義書 3.5 の UserSummary）。自分の情報（FN-01）・オーナー・作った人などに使う。
// User から作るときは UserSummaries を使う（アバターの署名付き URL を入れるため）
public record UserSummary(String username, String displayName, @Nullable String avatarUrl, @Nullable String statusEmoji,
		@Nullable String statusText) {

}
