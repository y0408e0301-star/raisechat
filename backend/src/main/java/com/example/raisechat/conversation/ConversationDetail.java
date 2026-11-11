package com.example.raisechat.conversation;

import java.time.Instant;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.user.UserSummary;

// 会話の詳細（FN-06 6 章の ConversationDetail）。ConversationSummary の項目に、説明・人数・作った人・作った日時を足したもの
record ConversationDetail(long id, long workspaceId, Conversation.Type type, @Nullable String name,
		Conversation.@Nullable Visibility visibility, boolean general, @Nullable UserSummary dmPartner, boolean joined,
		boolean hasUnread, int unreadCount, int mentionCount, boolean canPost, @Nullable String description,
		long memberCount, UserSummary createdBy, Instant createdAt) {

	static ConversationDetail of(Conversation c, boolean joined, long memberCount, UserSummary createdBy) {
		ConversationSummary s = ConversationSummary.of(c, joined);
		return new ConversationDetail(s.id(), s.workspaceId(), s.type(), s.name(), s.visibility(), s.general(),
				s.dmPartner(), s.joined(), s.hasUnread(), s.unreadCount(), s.mentionCount(), s.canPost(),
				c.getDescription(), memberCount, createdBy, c.getCreatedAt());
	}

}
