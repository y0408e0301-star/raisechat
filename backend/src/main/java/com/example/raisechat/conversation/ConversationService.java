package com.example.raisechat.conversation;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.message.MessageRepository;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.user.UserSummary;
import com.example.raisechat.workspace.WorkspaceAccess;
import com.example.raisechat.workspace.WorkspaceMember;

// サイドバーの会話の一覧・会話の詳細（FN-06）と、会話を開いたときの記録（FN-14・FN-03 5 章の 4）。
// チャンネルの作成・参加などは ChannelService、DM を始めるのは DirectMessageService
@Service
class ConversationService {

	private final ConversationRepository conversations;

	private final ConversationMemberRepository members;

	private final MessageRepository messages;

	private final WorkspaceAccess workspaceAccess;

	private final UserRepository users;

	private final DirectMessages directMessages;

	private final Clock clock;

	ConversationService(ConversationRepository conversations, ConversationMemberRepository members,
			MessageRepository messages, WorkspaceAccess workspaceAccess, UserRepository users,
			DirectMessages directMessages, Clock clock) {
		this.conversations = conversations;
		this.members = members;
		this.messages = messages;
		this.workspaceAccess = workspaceAccess;
		this.users = users;
		this.directMessages = directMessages;
		this.clock = clock;
	}

	// サイドバーに出す会話：自分が入っているチャンネル（general が先頭、名前の順）と、DM（DM-1。最後のメッセージの新しい順）
	@Transactional(readOnly = true)
	List<ConversationSummary> listForSidebar(long userId, long workspaceId) {
		this.workspaceAccess.requireMember(userId, workspaceId);
		List<ConversationSummary> list = new ArrayList<>();
		this.conversations.findJoinedChannels(userId, workspaceId)
			.forEach((c) -> list.add(ConversationSummary.of(c, true)));
		list.addAll(this.directMessages.summaries(this.conversations.findSidebarDms(userId, workspaceId), userId));
		return list;
	}

	// 会話の詳細。見られないときは 404（BR-2）
	@Transactional(readOnly = true)
	ConversationDetail get(long userId, long conversationId) {
		Conversation conversation = requireVisible(userId, conversationId);
		Instant now = this.clock.instant();
		UserSummary createdBy = UserSummary.of(this.users.findById(conversation.getCreatedBy()).orElseThrow(), now);
		long memberCount = this.members.countByConversationId(conversationId);
		if (conversation.getType() == Conversation.Type.DM) {
			return ConversationDetail.of(this.directMessages.summary(conversation, userId), conversation, memberCount,
					createdBy);
		}
		boolean joined = this.members.existsById(new ConversationMember.Key(conversationId, userId));
		return ConversationDetail.of(conversation, joined, memberCount, createdBy);
	}

	// 会話を開いた・読んだ（FN-14 6 章の read）。最後に読んだメッセージを進め、最後に開いた会話（W-4）を記録する。
	// lastMessageId はその会話の親メッセージの ID（FN-14 4 章）。メッセージがまだない会話では 0。
	// メンションを読んだことにするのは、メンション・通知（開発計画書 1-14・1-15）で足す
	@Transactional
	void read(long userId, long conversationId, @Nullable Long lastMessageId) {
		if (lastMessageId == null || lastMessageId < 0) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "lastMessageId");
		}
		Conversation conversation = requireVisible(userId, conversationId);
		if (lastMessageId > 0) {
			if (!this.messages.isParentInConversation(lastMessageId, conversationId)) {
				throw new ApiException(ErrorCode.BAD_REQUEST, "lastMessageId");
			}
			this.members.advanceLastRead(conversationId, userId, lastMessageId);
		}
		WorkspaceMember member = this.workspaceAccess.requireMember(userId, conversation.getWorkspaceId());
		member.openConversation(conversationId);
	}

	private Conversation requireVisible(long userId, long conversationId) {
		return this.conversations.findVisible(userId, conversationId)
			.orElseThrow(() -> new ApiException(ErrorCode.CONVERSATION_NOT_FOUND));
	}

}
