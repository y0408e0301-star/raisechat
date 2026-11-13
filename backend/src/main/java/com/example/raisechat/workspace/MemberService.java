package com.example.raisechat.workspace;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.conversation.ConversationMemberRepository;
import com.example.raisechat.conversation.ConversationRepository;
import com.example.raisechat.realtime.RealtimeEvent;
import com.example.raisechat.realtime.RealtimeNotifier;
import com.example.raisechat.realtime.SubscriptionRevoker;
import com.example.raisechat.user.User;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.user.UserSummary;

// メンバーの一覧・キック・退出（機能定義書 FN-05）。
// キック・退出した人には、コミットの後に workspace.removed を送り、そのワークスペースの会話の購読を取り消す（機能定義書 4.5）。
// DM の相手への通知（canPost: false）は DM（開発計画書 1-9）で足す
@Service
class MemberService {

	// 1 回に読む件数（FN-05 5 章の 6）
	static final int PAGE_SIZE = 50;

	private final WorkspaceMemberRepository members;

	private final WorkspaceRepository workspaces;

	private final WorkspaceAccess access;

	private final ConversationRepository conversations;

	private final ConversationMemberRepository conversationMembers;

	private final UserRepository users;

	private final RealtimeNotifier notifier;

	private final SubscriptionRevoker revoker;

	private final Clock clock;

	MemberService(WorkspaceMemberRepository members, WorkspaceRepository workspaces, WorkspaceAccess access,
			ConversationRepository conversations, ConversationMemberRepository conversationMembers,
			UserRepository users, RealtimeNotifier notifier, SubscriptionRevoker revoker, Clock clock) {
		this.members = members;
		this.workspaces = workspaces;
		this.access = access;
		this.conversations = conversations;
		this.conversationMembers = conversationMembers;
		this.users = users;
		this.notifier = notifier;
		this.revoker = revoker;
		this.clock = clock;
	}

	// G-9 の一覧（MB-1）：オーナーが先頭、表示名の順に 50 人ずつ。表示名かユーザー ID で絞り込める
	@Transactional(readOnly = true)
	WorkspaceMemberPage list(long me, long workspaceId, @Nullable String q, @Nullable String rawCursor) {
		this.access.requireMember(me, workspaceId);
		String pattern = MemberInputs.pattern(q);
		MemberInputs.Cursor cursor = MemberInputs.Cursor.parse(rawCursor);
		List<User> found = this.members.findMembers(workspaceId, pattern, cursor.rank(), cursor.displayName(),
				cursor.username(), PAGE_SIZE + 1);
		List<User> page = found.subList(0, Math.min(PAGE_SIZE, found.size()));
		Map<Long, WorkspaceMember> roles = page.isEmpty() ? Map.of()
				: this.members.findByUserIds(workspaceId, page.stream().map(User::getId).toList())
					.stream()
					.collect(Collectors.toMap(WorkspaceMember::getUserId, Function.identity()));
		Instant now = this.clock.instant();
		List<MemberView> items = page.stream()
			.map((u) -> MemberView.of(UserSummary.of(u, now), roles.get(u.getId())))
			.toList();
		String next = (found.size() > PAGE_SIZE) ? MemberInputs.Cursor.after(items.getLast()).format() : null;
		return new WorkspaceMemberPage(items, next, this.members.countByWorkspaceId(workspaceId));
	}

	// 1 人のメンバー（G-16。FN-02）。いなければ 404
	@Transactional(readOnly = true)
	MemberView get(long me, long workspaceId, String username) {
		this.access.requireMember(me, workspaceId);
		User user = this.users.findByUsername(username).orElseThrow(() -> new ApiException(ErrorCode.USER_NOT_FOUND));
		WorkspaceMember member = this.members.findById(new WorkspaceMember.Key(workspaceId, user.getId()))
			.orElseThrow(() -> new ApiException(ErrorCode.USER_NOT_FOUND));
		return MemberView.of(UserSummary.of(user, this.clock.instant()), member);
	}

	// キックする（MB-3・MB-4）。オーナーだけ。オーナー（自分を含む）はキックできない（5 章の 1）
	@Transactional
	void kick(long me, long workspaceId, String username) {
		if (this.access.requireMember(me, workspaceId).getRole() != WorkspaceMember.Role.OWNER) {
			throw new ApiException(ErrorCode.NOT_OWNER);
		}
		User user = this.users.findByUsername(username).orElseThrow(() -> new ApiException(ErrorCode.USER_NOT_FOUND));
		WorkspaceMember target = this.members.findById(new WorkspaceMember.Key(workspaceId, user.getId()))
			.orElseThrow(() -> new ApiException(ErrorCode.USER_NOT_FOUND));
		if (target.getRole() == WorkspaceMember.Role.OWNER) {
			throw new ApiException(ErrorCode.CANNOT_KICK_OWNER);
		}
		remove(workspaceId, user.getId(), RealtimeEvent.WorkspaceRemovedReason.KICKED);
	}

	// 退出する（MB-5）。オーナーは退出できない（5 章の 1）
	@Transactional
	void leave(long me, long workspaceId) {
		if (this.access.requireMember(me, workspaceId).getRole() == WorkspaceMember.Role.OWNER) {
			throw new ApiException(ErrorCode.OWNER_CANNOT_LEAVE);
		}
		remove(workspaceId, me, RealtimeEvent.WorkspaceRemovedReason.LEFT);
	}

	// ワークスペースのメンバーとチャンネルから外す（DM の行は残す。5 章の 3）。
	// 同時のキック・退出で、もういなければ何もしない（キックしようとした人がもういないのと同じ 404）。
	// ワークスペースの行はロックしない。同時に削除されたときは、削除の ON DELETE CASCADE が先にメンバーを消すので、
	// ここでは消す行がなくて 404 になる（削除の側が workspace.removed（DELETED）を送る）
	private void remove(long workspaceId, long userId, RealtimeEvent.WorkspaceRemovedReason reason) {
		if (this.members.deleteMember(workspaceId, userId) == 0) {
			throw new ApiException(ErrorCode.USER_NOT_FOUND);
		}
		this.conversationMembers.deleteChannelMemberships(workspaceId, userId);
		Workspace workspace = this.workspaces.findById(workspaceId).orElseThrow();
		this.notifier.toUser(userId, RealtimeEvent.Type.WORKSPACE_REMOVED, workspaceId, null,
				new RealtimeEvent.WorkspaceRemoved(workspaceId, workspace.getName(), reason));
		this.revoker.revoke(userId, this.conversations.findIdsByWorkspaceId(workspaceId));
	}

	// G-9 の一覧（機能定義書 3.4 の形に、ワークスペースの人数を足したもの）
	record WorkspaceMemberPage(List<MemberView> items, @Nullable String nextCursor, long memberCount) {
	}

}
