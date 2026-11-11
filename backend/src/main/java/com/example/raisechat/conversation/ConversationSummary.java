package com.example.raisechat.conversation;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.user.UserSummary;

// サイドバーの 1 行（機能定義書 3.5 の ConversationSummary）。
// 未読・メンションの件数は通知（開発計画書 1-15）で、DM の相手（dmPartner）と相手が抜けたときの canPost は DM（1-9）で入れる
record ConversationSummary(long id, long workspaceId, Conversation.Type type, @Nullable String name,
		Conversation.@Nullable Visibility visibility, boolean general, @Nullable UserSummary dmPartner, boolean joined,
		boolean hasUnread, int unreadCount, int mentionCount, boolean canPost) {

	// joined：チャンネルのメンバーか（DM は常に true）。チャンネルはメンバーのときだけ送れる
	static ConversationSummary of(Conversation c, boolean joined) {
		return new ConversationSummary(c.getId(), c.getWorkspaceId(), c.getType(), c.getName(), c.getVisibility(),
				c.isGeneral(), null, joined, false, 0, 0, joined);
	}

}
