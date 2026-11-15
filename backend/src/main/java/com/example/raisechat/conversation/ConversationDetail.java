package com.example.raisechat.conversation;

import java.time.Instant;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.user.UserSummary;

// 会話の詳細（FN-06 6 章の ConversationDetail）。ConversationSummary の項目に、説明・人数・作った人・作った日時と、
// 最後に読んだメッセージ（会話のメンバーでなければ null。開いたときに「新着」の線を出す位置。FN-07 MS-1）を足したもの
record ConversationDetail(long id, long workspaceId, Conversation.Type type, @Nullable String name,
		Conversation.@Nullable Visibility visibility, boolean general, @Nullable UserSummary dmPartner, boolean joined,
		boolean hasUnread, int unreadCount, int mentionCount, boolean canPost, @Nullable String description,
		long memberCount, UserSummary createdBy, Instant createdAt, @Nullable Long lastReadMessageId) {

	static ConversationDetail of(Conversation c, boolean joined, long memberCount, UserSummary createdBy) {
		return of(ConversationSummary.of(c, joined), c, memberCount, createdBy, null);
	}

	// DM（FN-12）など、サイドバーの行を先に作ったもの
	static ConversationDetail of(ConversationSummary s, Conversation c, long memberCount, UserSummary createdBy,
			@Nullable Long lastReadMessageId) {
		return new ConversationDetail(s.id(), s.workspaceId(), s.type(), s.name(), s.visibility(), s.general(),
				s.dmPartner(), s.joined(), s.hasUnread(), s.unreadCount(), s.mentionCount(), s.canPost(),
				c.getDescription(), memberCount, createdBy, c.getCreatedAt(), lastReadMessageId);
	}

}
