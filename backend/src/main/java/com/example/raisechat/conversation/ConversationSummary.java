package com.example.raisechat.conversation;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.user.UserSummary;

// サイドバーの 1 行（機能定義書 3.5 の ConversationSummary）。
// 未読・メンションの件数は通知（開発計画書 1-15）で入れる
record ConversationSummary(long id, long workspaceId, Conversation.Type type, @Nullable String name,
		Conversation.@Nullable Visibility visibility, boolean general, @Nullable UserSummary dmPartner, boolean joined,
		boolean hasUnread, int unreadCount, int mentionCount, boolean canPost) {

	// DM（FN-12）。partner：相手、canPost：相手がいまワークスペースのメンバーか（DM-6）
	static ConversationSummary ofDm(Conversation c, UserSummary partner, boolean canPost) {
		return new ConversationSummary(c.getId(), c.getWorkspaceId(), c.getType(), null, null, false, partner, true,
				false, 0, 0, canPost);
	}

	// チャンネル。joined：チャンネルのメンバーか。メンバーのときだけ送れる
	static ConversationSummary of(Conversation c, boolean joined) {
		return new ConversationSummary(c.getId(), c.getWorkspaceId(), c.getType(), c.getName(), c.getVisibility(),
				c.isGeneral(), null, joined, false, 0, 0, joined);
	}

}
