package com.example.raisechat.conversation;

import org.springframework.stereotype.Component;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;

// 会話を見られるか（データ設計書 8.1）・送れるか（ConversationSummary の canPost）を確かめる。
// メッセージの送信（FN-07）と添付のアップロード（FN-09）で同じ決まりを使う
@Component
public class ConversationAccess {

	private final ConversationRepository conversations;

	private final ConversationMemberRepository members;

	private final DirectMessages directMessages;

	ConversationAccess(ConversationRepository conversations, ConversationMemberRepository members,
			DirectMessages directMessages) {
		this.conversations = conversations;
		this.members = members;
		this.directMessages = directMessages;
	}

	// 見られなければ 404 CONVERSATION_NOT_FOUND
	public Conversation requireVisible(long me, long conversationId) {
		return this.conversations.findVisible(me, conversationId)
			.orElseThrow(() -> new ApiException(ErrorCode.CONVERSATION_NOT_FOUND));
	}

	// チャンネルはメンバーのときだけ。DM は相手がいまワークスペースのメンバーのときだけ（FN-12 DM-6）
	public void requireCanPost(long me, Conversation conversation) {
		if (conversation.getType() == Conversation.Type.DM) {
			if (!this.directMessages.canPost(conversation, me)) {
				throw new ApiException(ErrorCode.DM_PARTNER_LEFT);
			}
			return;
		}
		if (!this.members.existsById(new ConversationMember.Key(conversation.getId(), me))) {
			throw new ApiException(ErrorCode.NOT_CHANNEL_MEMBER);
		}
	}

}
