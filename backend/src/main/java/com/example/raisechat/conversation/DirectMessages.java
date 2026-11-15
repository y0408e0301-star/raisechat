package com.example.raisechat.conversation;

import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;

import com.example.raisechat.message.MessageRepository;
import com.example.raisechat.realtime.RealtimeEvent;
import com.example.raisechat.realtime.RealtimeNotifier;
import com.example.raisechat.unread.UnreadCounts;
import com.example.raisechat.user.User;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.user.UserSummaries;
import com.example.raisechat.user.UserSummary;
import com.example.raisechat.workspace.WorkspaceMemberRepository;

// DM の見え方（機能定義書 FN-12）：相手（dmPartner）と送れるか（canPost）、サイドバーへの出し方と、その通知。
// メッセージの送信（FN-07）・キック・退出・また参加（FN-05・FN-04）からも使う
@Component
public class DirectMessages {

	private final ConversationRepository conversations;

	private final WorkspaceMemberRepository workspaceMembers;

	private final MessageRepository messages;

	private final UserRepository users;

	private final UserSummaries userSummaries;

	private final RealtimeNotifier notifier;

	private final Clock clock;

	private final UnreadCounts unreadCounts;

	DirectMessages(ConversationRepository conversations, WorkspaceMemberRepository workspaceMembers,
			MessageRepository messages, UserRepository users, UserSummaries userSummaries, RealtimeNotifier notifier,
			Clock clock, UnreadCounts unreadCounts) {
		this.conversations = conversations;
		this.workspaceMembers = workspaceMembers;
		this.messages = messages;
		this.users = users;
		this.userSummaries = userSummaries;
		this.notifier = notifier;
		this.clock = clock;
		this.unreadCounts = unreadCounts;
	}

	// 送れるのは、2 人ともいまワークスペースのメンバーのとき（5 章の 3）。見ている本人はメンバーなので、相手だけを確かめる
	public boolean canPost(Conversation dm, long viewer) {
		return isMember(dm.getWorkspaceId(), dm.partnerOf(viewer));
	}

	// viewer から見たサイドバーの行（相手と送れるか）。DM はまとめて相手を読む。
	// 相手のユーザーは必ずある（退会の機能はなく、users の行は消さない。要件定義書 U-4）
	List<ConversationSummary> summaries(List<Conversation> dms, long viewer) {
		if (dms.isEmpty()) {
			return List.of();
		}
		Instant now = this.clock.instant();
		Map<Long, User> partners = this.users.findAllById(dms.stream().map((c) -> c.partnerOf(viewer)).toList())
			.stream()
			.collect(Collectors.toMap(User::getId, Function.identity()));
		Set<Long> members = new HashSet<>(this.workspaceMembers.findUserIds(dms.getFirst().getWorkspaceId()));
		Map<Long, UnreadCounts.Counts> counts = this.unreadCounts.ofConversations(viewer,
				dms.stream().map(Conversation::getId).toList());
		return dms.stream().map((c) -> {
			long partner = c.partnerOf(viewer);
			return ConversationSummary
				.ofDm(c, this.userSummaries.of(partners.get(partner), now), members.contains(partner))
				.withCounts(counts.getOrDefault(c.getId(), UnreadCounts.Counts.NONE));
		}).toList();
	}

	ConversationSummary summary(Conversation dm, long viewer) {
		return summaries(List.of(dm), viewer).getFirst();
	}

	// viewer から見た相手（メンションの一覧の会話の名前。FN-14 NT-5）
	public UserSummary partner(Conversation dm, long viewer) {
		User partner = this.users.findById(dm.partnerOf(viewer)).orElseThrow();
		return this.userSummaries.of(partner, this.clock.instant());
	}

	// userId がワークスペースから抜けた・また参加したとき：その人との DM の相手に、送れるかが変わったことを知らせる
	// （FN-05 MB-6・MB-8）。相手のサイドバーに出ていない DM（メッセージがなく、相手が作ったのでもない）は知らせない
	public void membershipChanged(long userId, long workspaceId) {
		for (Conversation dm : this.conversations.findJoinedDms(userId, workspaceId)) {
			long partner = dm.partnerOf(userId);
			if (isMember(workspaceId, partner) && inSidebarOf(dm, partner)) {
				notifyUpdated(dm, partner);
			}
		}
	}

	// メッセージのない DM は、作った人のサイドバーにだけ出す（5 章の 4）
	boolean inSidebarOf(Conversation dm, long viewer) {
		return dm.getCreatedBy() == viewer || this.messages.existsByConversationId(dm.getId());
	}

	private void notifyUpdated(Conversation dm, long viewer) {
		this.notifier.toUser(viewer, RealtimeEvent.Type.CONVERSATION_UPDATED, dm.getWorkspaceId(), dm.getId(),
				summary(dm, viewer));
	}

	private boolean isMember(long workspaceId, long userId) {
		return this.workspaceMembers.existsByWorkspaceIdAndUserId(workspaceId, userId);
	}

}
