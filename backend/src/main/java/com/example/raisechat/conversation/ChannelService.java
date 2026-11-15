package com.example.raisechat.conversation;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.hibernate.exception.ConstraintViolationException;
import org.jspecify.annotations.Nullable;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.raisechat.attachment.Attachments;
import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.message.MessageRepository;
import com.example.raisechat.realtime.RealtimeEvent;
import com.example.raisechat.realtime.RealtimeNotifier;
import com.example.raisechat.realtime.SubscriptionRevoker;
import com.example.raisechat.unread.UnreadCounts;
import com.example.raisechat.user.User;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.user.UserSummaries;
import com.example.raisechat.user.UserSummary;
import com.example.raisechat.workspace.WorkspaceAccess;
import com.example.raisechat.workspace.WorkspaceMember;
import com.example.raisechat.workspace.WorkspaceMemberRepository;

// チャンネルの一覧・作成・参加・退出・招待・削除と、会話のメンバー（機能定義書 FN-06）。
// 変えたら、コミットの後に本人あてのリアルタイムの通知を送る（FN-06 6 章）。
// 削除したチャンネルの添付のファイル（S3）を消すのは、添付（開発計画書 1-11）で足す
@Service
class ChannelService {

	// G-8 の一覧・会話のメンバーの一覧を 1 回に読む件数（FN-06 5 章の 7）
	static final int PAGE_SIZE = 50;

	// 招待の候補を出す人数の上限。名前で絞り込んで探す
	static final int CANDIDATE_LIMIT = 50;

	// 1 回に招待できる人数（FN-06 4 章）
	static final int INVITE_MAX = 50;

	// 同じワークスペースに同じ名前のチャンネルを作らないための一意の索引（V2）
	private static final String NAME_CONSTRAINT = "conversations_channel_name_key";

	private final ConversationRepository conversations;

	private final ConversationMemberRepository members;

	private final WorkspaceMemberRepository workspaceMembers;

	private final MessageRepository messages;

	private final WorkspaceAccess workspaceAccess;

	private final UserRepository users;

	private final UserSummaries userSummaries;

	private final RealtimeNotifier notifier;

	private final SubscriptionRevoker revoker;

	private final Attachments attachments;

	private final Clock clock;

	private final UnreadCounts unreadCounts;

	private final CountNotices countNotices;

	ChannelService(ConversationRepository conversations, ConversationMemberRepository members,
			WorkspaceMemberRepository workspaceMembers, MessageRepository messages, WorkspaceAccess workspaceAccess,
			UserRepository users, UserSummaries userSummaries, RealtimeNotifier notifier, SubscriptionRevoker revoker,
			Attachments attachments, Clock clock, UnreadCounts unreadCounts, CountNotices countNotices) {
		this.conversations = conversations;
		this.members = members;
		this.workspaceMembers = workspaceMembers;
		this.messages = messages;
		this.workspaceAccess = workspaceAccess;
		this.users = users;
		this.userSummaries = userSummaries;
		this.notifier = notifier;
		this.revoker = revoker;
		this.attachments = attachments;
		this.clock = clock;
		this.unreadCounts = unreadCounts;
		this.countNotices = countNotices;
	}

	// G-8 の一覧（CH-3）：公開チャンネルと、自分が入っているプライベートチャンネルを名前の順に 50 件ずつ
	@Transactional(readOnly = true)
	ChannelPage list(long me, long workspaceId, @Nullable String q, @Nullable String rawCursor) {
		this.workspaceAccess.requireMember(me, workspaceId);
		String pattern = ChannelInputs.pattern(q);
		ChannelInputs.Cursor cursor = ChannelInputs.Cursor.parse(rawCursor);
		List<ChannelRow> rows = this.conversations.findChannels(me, workspaceId, pattern, cursor.name(), cursor.id(),
				PAGE_SIZE + 1);
		List<ChannelListItem> items = rows.stream().limit(PAGE_SIZE).map(ChannelListItem::of).toList();
		String next = (rows.size() > PAGE_SIZE)
				? new ChannelInputs.Cursor(items.getLast().id(), items.getLast().name()).format() : null;
		return new ChannelPage(items, next);
	}

	// 作る（CH-2）。自分をメンバーにする。同じ名前（大文字・小文字を区別しない）があれば 409
	@Transactional
	ConversationDetail create(long me, long workspaceId, @Nullable String rawName, @Nullable String rawDescription,
			@Nullable String rawVisibility) {
		this.workspaceAccess.requireMember(me, workspaceId);
		String name = ChannelInputs.name(rawName);
		String description = ChannelInputs.description(rawDescription);
		Conversation.Visibility visibility = ChannelInputs.visibility(rawVisibility);
		Instant now = this.clock.instant();
		Conversation channel;
		try {
			channel = this.conversations
				.saveAndFlush(Conversation.channel(workspaceId, name, description, visibility, me, now));
		}
		catch (DataIntegrityViolationException ex) {
			if (isDuplicateName(ex)) {
				throw new ApiException(ErrorCode.CHANNEL_NAME_TAKEN, "name");
			}
			throw ex;
		}
		this.members.save(new ConversationMember(channel.getId(), me, 0, now));
		notifyJoined(me, channel);
		return detail(channel);
	}

	// 参加する（CH-4・CH-5）。公開チャンネルだけ。もう入っていれば何もしない
	@Transactional
	ConversationDetail join(long me, long conversationId) {
		Conversation channel = requireVisible(me, conversationId);
		if (channel.getType() != Conversation.Type.CHANNEL
				|| channel.getVisibility() != Conversation.Visibility.PUBLIC) {
			throw new ApiException(ErrorCode.PRIVATE_CHANNEL);
		}
		if (addMember(conversationId, me)) {
			notifyJoined(me, channel);
		}
		return detail(channel);
	}

	// 退出する（CH-8）。general からは退出できない。入っていなければ何もしない。
	// プライベートチャンネルからは、退出した時点で見られなくなるので購読を取り消す（機能定義書 4.5）
	@Transactional
	void leave(long me, long conversationId) {
		Conversation channel = requireChannel(me, conversationId);
		if (channel.isGeneral()) {
			throw new ApiException(ErrorCode.CANNOT_LEAVE_GENERAL);
		}
		ConversationMember.Key key = new ConversationMember.Key(conversationId, me);
		if (!this.members.existsById(key)) {
			return;
		}
		this.members.deleteById(key);
		this.notifier.toUser(me, RealtimeEvent.Type.CONVERSATION_REMOVED, channel.getWorkspaceId(), conversationId,
				new RealtimeEvent.ConversationRemoved(conversationId, RealtimeEvent.RemovedReason.LEFT));
		if (channel.getVisibility() == Conversation.Visibility.PRIVATE) {
			this.revoker.revoke(me, conversationId);
		}
		// 抜けたチャンネルの未読は数えない。プライベートならメンションも見られなくなる（NT-11）
		this.countNotices.workspaceChanged(channel.getWorkspaceId(), List.of(me));
	}

	// プライベートチャンネルに招待する（CH-7）。招待する人はそのチャンネルのメンバー（見られるので入っている）。
	// 1 人でもワークスペースにいなければ誰も足さない。もう入っている人は飛ばし、足した人を返す
	@Transactional
	List<UserSummary> invite(long me, long conversationId, @Nullable List<String> rawUsernames) {
		Conversation channel = requireChannel(me, conversationId);
		if (channel.getVisibility() != Conversation.Visibility.PRIVATE) {
			throw new ApiException(ErrorCode.NOT_PRIVATE_CHANNEL);
		}
		Map<String, User> invitees = new LinkedHashMap<>();
		for (String username : usernames(rawUsernames)) {
			User user = this.users.findByUsername(username)
				.filter((u) -> this.workspaceMembers
					.existsById(new WorkspaceMember.Key(channel.getWorkspaceId(), u.getId())))
				.orElseThrow(() -> new ApiException(ErrorCode.USER_NOT_FOUND, "usernames"));
			invitees.putIfAbsent(user.getUsername(), user);
		}
		Instant now = this.clock.instant();
		List<UserSummary> added = new ArrayList<>();
		for (User user : invitees.values()) {
			if (addMember(conversationId, user.getId())) {
				notifyJoined(user.getId(), channel);
				added.add(this.userSummaries.of(user, now));
			}
		}
		return added;
	}

	// 削除する（CH-9）。オーナーだけ、general 以外。プライベートチャンネルはオーナーがメンバーのときだけ（見られるとき）。
	// 消す前に見られた人に、コミットの後で conversation.removed（DELETED）を送り、購読を取り消す（CH-10、機能定義書 4.5）。
	// 添付の行は会話と一緒に消え、S3 のファイルはコミットの後で消す（BR-12）
	@Transactional
	void delete(long me, long conversationId) {
		Conversation channel = requireChannel(me, conversationId);
		if (channel.isGeneral()) {
			throw new ApiException(ErrorCode.CANNOT_DELETE_GENERAL);
		}
		if (this.workspaceAccess.requireMember(me, channel.getWorkspaceId()).getRole() != WorkspaceMember.Role.OWNER) {
			throw new ApiException(ErrorCode.NOT_OWNER);
		}
		List<Long> viewers = (channel.getVisibility() == Conversation.Visibility.PUBLIC)
				? this.workspaceMembers.findUserIds(channel.getWorkspaceId())
				: this.members.findUserIds(conversationId);
		this.attachments.deleteFilesOfConversation(conversationId);
		this.conversations.delete(channel);
		for (long viewer : viewers) {
			this.notifier.toUser(viewer, RealtimeEvent.Type.CONVERSATION_REMOVED, channel.getWorkspaceId(),
					conversationId,
					new RealtimeEvent.ConversationRemoved(conversationId, RealtimeEvent.RemovedReason.DELETED));
			this.revoker.revoke(viewer, conversationId);
		}
		// 消えたチャンネルの未読・メンションは数えない（NT-11）
		this.countNotices.workspaceChanged(channel.getWorkspaceId(), viewers);
	}

	// 会話のメンバー（CH-6）：表示名の順に 50 人ずつ。表示名かユーザー ID で絞り込める
	@Transactional(readOnly = true)
	MemberPage members(long me, long conversationId, @Nullable String q, @Nullable String rawCursor) {
		requireVisible(me, conversationId);
		String pattern = ChannelInputs.pattern(q);
		ChannelInputs.Cursor cursor = ChannelInputs.Cursor.parse(rawCursor);
		List<User> found = this.members.findMembers(conversationId, pattern, cursor.name(), cursor.id(), PAGE_SIZE + 1);
		List<User> page = found.subList(0, Math.min(PAGE_SIZE, found.size()));
		Instant now = this.clock.instant();
		String next = (found.size() > PAGE_SIZE)
				? new ChannelInputs.Cursor(page.getLast().getId(), page.getLast().getDisplayName()).format() : null;
		return new MemberPage(page.stream().map((u) -> this.userSummaries.of(u, now)).toList(), next);
	}

	// 招待の候補（CH-7）：そのチャンネルにいないワークスペースのメンバー。表示名かユーザー ID で絞り込む
	@Transactional(readOnly = true)
	List<UserSummary> candidates(long me, long conversationId, @Nullable String q) {
		Conversation channel = requireChannel(me, conversationId);
		if (channel.getVisibility() != Conversation.Visibility.PRIVATE) {
			throw new ApiException(ErrorCode.NOT_PRIVATE_CHANNEL);
		}
		Instant now = this.clock.instant();
		return this.members
			.findCandidates(channel.getWorkspaceId(), conversationId, ChannelInputs.pattern(q), CANDIDATE_LIMIT)
			.stream()
			.map((u) -> this.userSummaries.of(u, now))
			.toList();
	}

	private Conversation requireVisible(long me, long conversationId) {
		return this.conversations.findVisible(me, conversationId)
			.orElseThrow(() -> new ApiException(ErrorCode.CONVERSATION_NOT_FOUND));
	}

	// チャンネルの操作。DM は見られてもチャンネルとしては扱わない（403）
	private Conversation requireChannel(long me, long conversationId) {
		Conversation conversation = requireVisible(me, conversationId);
		if (conversation.getType() != Conversation.Type.CHANNEL) {
			throw new ApiException(ErrorCode.FORBIDDEN);
		}
		return conversation;
	}

	// 参加・招待したときは、最後に読んだメッセージをいまの最新にする（FN-06 5 章の 2）。
	// もう入っていれば何もせず false（同時に 2 回参加しても、2 回目は失敗にしない）
	private boolean addMember(long conversationId, long userId) {
		long latest = this.messages.findLatestId(conversationId);
		return this.members.insertIfAbsent(conversationId, userId, latest, this.clock.instant()) == 1;
	}

	// 入った人のサイドバーに足す（ほかのタブ・招待された人の画面のため）
	private void notifyJoined(long userId, Conversation channel) {
		this.notifier.toUser(userId, RealtimeEvent.Type.CONVERSATION_UPDATED, channel.getWorkspaceId(), channel.getId(),
				ConversationSummary.of(channel, true)
					.withCounts(this.unreadCounts.ofConversation(userId, channel.getId())));
	}

	// 参加した人から見た詳細
	private ConversationDetail detail(Conversation channel) {
		Instant now = this.clock.instant();
		UserSummary createdBy = this.userSummaries.of(this.users.findById(channel.getCreatedBy()).orElseThrow(), now);
		long memberCount = this.members.countByConversationId(channel.getId());
		return ConversationDetail.of(channel, true, memberCount, createdBy);
	}

	// 1〜50 人。同じ人（大文字・小文字の違い）は 1 人にする
	private static Set<String> usernames(@Nullable List<String> raw) {
		if (raw == null || raw.isEmpty() || raw.size() > INVITE_MAX || raw.stream().anyMatch((u) -> u == null)) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "usernames");
		}
		return raw.stream().map((u) -> u.toLowerCase(Locale.ROOT)).collect(Collectors.toCollection(LinkedHashSet::new));
	}

	// 一意の索引に反したか。例外の文はドライバの言語設定で変わるので、制約の名前で比べる
	private static boolean isDuplicateName(DataIntegrityViolationException ex) {
		for (Throwable cause = ex; cause != null; cause = cause.getCause()) {
			if (cause instanceof ConstraintViolationException violation) {
				return NAME_CONSTRAINT.equals(violation.getConstraintName());
			}
		}
		return false;
	}

	// G-8 の一覧（機能定義書 3.4 の形）
	record ChannelPage(List<ChannelListItem> items, @Nullable String nextCursor) {
	}

	// 会話のメンバーの一覧（機能定義書 3.4 の形）
	record MemberPage(List<UserSummary> items, @Nullable String nextCursor) {
	}

	// G-8 の 1 行（FN-06 6 章の ChannelListItem）
	record ChannelListItem(long id, String name, @Nullable String description, Conversation.Visibility visibility,
			long memberCount, boolean joined) {

		static ChannelListItem of(ChannelRow row) {
			return new ChannelListItem(row.getId(), row.getName(), row.getDescription(),
					Conversation.Visibility.valueOf(row.getVisibility()), row.getMemberCount(), row.getJoined());
		}

	}

}
