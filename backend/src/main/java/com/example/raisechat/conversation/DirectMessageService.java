package com.example.raisechat.conversation;

import java.time.Clock;
import java.time.Instant;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.user.User;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.user.UserSummary;
import com.example.raisechat.workspace.WorkspaceAccess;
import com.example.raisechat.workspace.WorkspaceMemberRepository;

// DM を始める（機能定義書 FN-12 DM-2）。DM を作っただけでは通知しない（6 章）
@Service
class DirectMessageService {

	private final ConversationRepository conversations;

	private final ConversationMemberRepository members;

	private final WorkspaceMemberRepository workspaceMembers;

	private final WorkspaceAccess workspaceAccess;

	private final UserRepository users;

	private final DirectMessages directMessages;

	private final Clock clock;

	DirectMessageService(ConversationRepository conversations, ConversationMemberRepository members,
			WorkspaceMemberRepository workspaceMembers, WorkspaceAccess workspaceAccess, UserRepository users,
			DirectMessages directMessages, Clock clock) {
		this.conversations = conversations;
		this.members = members;
		this.workspaceMembers = workspaceMembers;
		this.workspaceAccess = workspaceAccess;
		this.users = users;
		this.directMessages = directMessages;
		this.clock = clock;
	}

	// 相手との DM を返す。なければ作り、2 人を会話のメンバーにする。同時に作られても 1 つにする（5 章の 1）
	@Transactional
	Started start(long me, long workspaceId, @Nullable String username) {
		this.workspaceAccess.requireMember(me, workspaceId);
		if (username == null) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "username");
		}
		User partner = this.users.findByUsername(username)
			.orElseThrow(() -> new ApiException(ErrorCode.USER_NOT_FOUND, "username"));
		if (partner.getId() == me) {
			throw new ApiException(ErrorCode.CANNOT_DM_SELF, "username");
		}
		if (!this.workspaceMembers.existsByWorkspaceIdAndUserId(workspaceId, partner.getId())) {
			throw new ApiException(ErrorCode.USER_NOT_FOUND, "username");
		}
		long low = Math.min(me, partner.getId());
		long high = Math.max(me, partner.getId());
		Instant now = this.clock.instant();
		boolean created = this.conversations.insertDmIfAbsent(workspaceId, low, high, me, now) == 1;
		Conversation dm = this.conversations.findDm(workspaceId, low, high).orElseThrow();
		if (created) {
			// メッセージがまだないので、最後に読んだメッセージは 0
			this.members.insertIfAbsent(dm.getId(), low, 0, now);
			this.members.insertIfAbsent(dm.getId(), high, 0, now);
		}
		UserSummary createdBy = UserSummary.of(this.users.findById(dm.getCreatedBy()).orElseThrow(), now);
		ConversationDetail detail = ConversationDetail.of(this.directMessages.summary(dm, me), dm, 2, createdBy);
		return new Started(detail, created);
	}

	// created：新しく作ったか（201 と 200 を分ける）
	record Started(ConversationDetail detail, boolean created) {
	}

}
