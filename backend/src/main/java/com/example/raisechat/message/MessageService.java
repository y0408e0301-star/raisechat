package com.example.raisechat.message;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import org.hibernate.exception.ConstraintViolationException;
import org.jspecify.annotations.Nullable;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import com.example.raisechat.attachment.AttachmentView;
import com.example.raisechat.attachment.Attachments;
import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.conversation.Conversation;
import com.example.raisechat.conversation.ConversationAccess;
import com.example.raisechat.conversation.ConversationRepository;
import com.example.raisechat.conversation.DirectMessages;
import com.example.raisechat.reaction.ReactionView;
import com.example.raisechat.reaction.Reactions;
import com.example.raisechat.realtime.RealtimeEvent;
import com.example.raisechat.realtime.RealtimeNotifier;
import com.example.raisechat.user.User;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.user.UserSummaries;
import com.example.raisechat.user.UserSummary;
import com.example.raisechat.workspace.WorkspaceAccess;
import com.example.raisechat.workspace.WorkspaceMember;

// メッセージの一覧・送信・編集・削除（機能定義書 FN-07）。
// 送信・編集・削除は、コミットの後に会話を見ている人へリアルタイムの通知を送る（FN-07 6 章）。
// 添付（FN-09）は送信で結びつけ、編集で外し、削除で消す（S3 のファイルはコミットの後。BR-12）。
// 未読・メンションの通知（conversation.updated・notify）は 1-15、スレッドの返信は 1-12、メンションは 1-14 で足す
@Service
class MessageService {

	// 1 回に読み込む件数の上限と、指定がないときの件数（FN-07 6 章）
	static final int MAX_LIMIT = 50;

	// 親メッセージの返信の件数の行に出す、返信した人の数（画面設計書 2.9）
	static final int MAX_REPLY_USERS = 3;

	// 同じ人が同じ clientId で 2 回追加しないための一意の制約の名前（V3__create_messages.sql）
	private static final String CLIENT_ID_CONSTRAINT = "messages_user_client_key";

	private final MessageRepository messages;

	private final ConversationRepository conversations;

	private final ConversationAccess access;

	private final Attachments attachments;

	private final WorkspaceAccess workspaceAccess;

	private final UserRepository users;

	private final UserSummaries userSummaries;

	private final Clock clock;

	private final TransactionTemplate transaction;

	private final RealtimeNotifier notifier;

	private final DirectMessages directMessages;

	private final Reactions reactions;

	MessageService(MessageRepository messages, ConversationRepository conversations, ConversationAccess access,
			Attachments attachments, WorkspaceAccess workspaceAccess, UserRepository users, UserSummaries userSummaries,
			Clock clock, TransactionTemplate transaction, RealtimeNotifier notifier, DirectMessages directMessages,
			Reactions reactions) {
		this.messages = messages;
		this.conversations = conversations;
		this.access = access;
		this.attachments = attachments;
		this.workspaceAccess = workspaceAccess;
		this.users = users;
		this.userSummaries = userSummaries;
		this.clock = clock;
		this.transaction = transaction;
		this.notifier = notifier;
		this.directMessages = directMessages;
		this.reactions = reactions;
	}

	// 会話のメッセージの一覧（MS-1・MS-2）。before・after のどちらか、またはなし（最新）。古い順に返す
	@Transactional(readOnly = true)
	MessagePage list(long me, long conversationId, @Nullable Long before, @Nullable Long after,
			@Nullable Integer rawLimit) {
		int limit = validLimit(before, after, rawLimit);
		Conversation conversation = requireVisible(me, conversationId);
		Paged paged = page(before, after, limit, new PageQueries() {
			@Override
			public List<Message> latest(Limit plusOne) {
				return MessageService.this.messages.findLatest(conversationId, plusOne);
			}

			@Override
			public List<Message> before(long id, Limit plusOne) {
				return MessageService.this.messages.findBefore(conversationId, id, plusOne);
			}

			@Override
			public List<Message> after(long id, Limit plusOne) {
				return MessageService.this.messages.findAfter(conversationId, id, plusOne);
			}

			@Override
			public boolean existsBefore(long id) {
				return MessageService.this.messages.existsBefore(conversationId, id);
			}

			@Override
			public boolean existsAfter(long id) {
				return MessageService.this.messages.existsAfter(conversationId, id);
			}
		});
		return new MessagePage(views(me, conversation, paged.items()), paged.hasMoreBefore(), paged.hasMoreAfter());
	}

	// スレッドの返信の一覧（TH-1、FN-08 6 章）。親メッセージと、返信を古い順に 50 件ずつ。
	// 「削除されました」の親のスレッドも開ける（TH-7）
	@Transactional(readOnly = true)
	ReplyPage replies(long me, long parentId, @Nullable Long before, @Nullable Long after, @Nullable Integer rawLimit) {
		int limit = validLimit(before, after, rawLimit);
		Message parent = this.messages.findById(parentId)
			.filter((m) -> !m.isReply())
			.orElseThrow(MessageService::notFound);
		Conversation conversation = this.conversations.findVisible(me, parent.getConversationId())
			.orElseThrow(MessageService::notFound);
		Paged paged = page(before, after, limit, new PageQueries() {
			@Override
			public List<Message> latest(Limit plusOne) {
				return MessageService.this.messages.findLatestReplies(parentId, plusOne);
			}

			@Override
			public List<Message> before(long id, Limit plusOne) {
				return MessageService.this.messages.findRepliesBefore(parentId, id, plusOne);
			}

			@Override
			public List<Message> after(long id, Limit plusOne) {
				return MessageService.this.messages.findRepliesAfter(parentId, id, plusOne);
			}

			@Override
			public boolean existsBefore(long id) {
				return MessageService.this.messages.existsReplyBefore(parentId, id);
			}

			@Override
			public boolean existsAfter(long id) {
				return MessageService.this.messages.existsReplyAfter(parentId, id);
			}
		});
		return new ReplyPage(view(me, conversation, parent), views(me, conversation, paged.items()),
				paged.hasMoreBefore(), paged.hasMoreAfter());
	}

	private static int validLimit(@Nullable Long before, @Nullable Long after, @Nullable Integer rawLimit) {
		if (before != null && after != null) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "before");
		}
		int limit = (rawLimit == null) ? MAX_LIMIT : rawLimit;
		if (limit < 1 || limit > MAX_LIMIT) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "limit");
		}
		return limit;
	}

	// before・after のどちらか、またはなし（最新）で limit 件を読み、古い順に返す。会話の一覧とスレッドの返信の一覧で使う
	private static Paged page(@Nullable Long before, @Nullable Long after, int limit, PageQueries queries) {
		// 1 件多く読んで、続きがあるかを知る
		Limit plusOne = Limit.of(limit + 1);
		List<Message> found;
		boolean hasMoreBefore;
		boolean hasMoreAfter;
		if (after != null) {
			found = new ArrayList<>(queries.after(after, plusOne));
			hasMoreAfter = found.size() > limit;
			found = found.subList(0, Math.min(limit, found.size()));
			// 前があるか：読んだものの最初より前。1 件もなければ after 以前（after + 1 より前）にあるか
			hasMoreBefore = queries.existsBefore(found.isEmpty() ? after + 1 : first(found));
		}
		else {
			found = new ArrayList<>((before != null) ? queries.before(before, plusOne) : queries.latest(plusOne));
			hasMoreBefore = found.size() > limit;
			found = new ArrayList<>(found.subList(0, Math.min(limit, found.size())));
			Collections.reverse(found);
			// 後ろがあるか：最新を読んだときはない。before を指定したときは、読んだものの最後より後ろ。
			// 1 件もなければ before 以降（before - 1 より後ろ）にあるか
			hasMoreAfter = (before != null) && queries.existsAfter(found.isEmpty() ? before - 1 : last(found));
		}
		return new Paged(found, hasMoreBefore, hasMoreAfter);
	}

	// 一覧を読む問い合わせ（会話のメッセージか、スレッドの返信か）
	private interface PageQueries {

		// 最新から古い順に
		List<Message> latest(Limit plusOne);

		// id より前を、新しい順に
		List<Message> before(long id, Limit plusOne);

		// id より後を、古い順に
		List<Message> after(long id, Limit plusOne);

		boolean existsBefore(long id);

		boolean existsAfter(long id);

	}

	private record Paged(List<Message> items, boolean hasMoreBefore, boolean hasMoreAfter) {
	}

	// 1 件のメッセージ（添付の署名付き URL の期限が切れたときに読み直す。AT-10）
	@Transactional(readOnly = true)
	MessageView get(long me, long messageId) {
		Message message = this.messages.findById(messageId).orElseThrow(MessageService::notFound);
		Conversation conversation = this.conversations.findVisible(me, message.getConversationId())
			.orElseThrow(MessageService::notFound);
		return view(me, conversation, message);
	}

	// 送る（MS-3）。同じ clientId で 2 回送られたときは、2 つ目を追加せず 1 つ目を返す（FN-07 5 章の 8）。
	// 添付（AT-3）があれば本文は空でもよい
	MessageView post(long me, long conversationId, @Nullable String rawBody, @Nullable String rawClientId,
			@Nullable List<Long> rawAttachmentIds) {
		Sending sending = Sending.of(rawBody, rawClientId, rawAttachmentIds);
		return send(me, sending,
				() -> insert(me, conversationId, sending.body(), sending.clientId(), sending.attachmentIds()),
				(sent) -> sameSend(me, conversationId, sent));
	}

	// スレッドに返信する（TH-3）。送り方・clientId・添付は会話への送信と同じ。返信への返信はできない（TH-5）
	MessageView postReply(long me, long parentId, @Nullable String rawBody, @Nullable String rawClientId,
			@Nullable List<Long> rawAttachmentIds) {
		Sending sending = Sending.of(rawBody, rawClientId, rawAttachmentIds);
		return send(me, sending,
				() -> insertReply(me, parentId, sending.body(), sending.clientId(), sending.attachmentIds()),
				(sent) -> sameReply(me, parentId, sent));
	}

	// 1 つのトランザクションで追加する。同じ clientId が同時に送られ、もう一方が先に追加した（一意の制約）ときは、
	// 先に追加したものを読み直して same で確かめて返す。それ以外の失敗はそのまま投げる
	private MessageView send(long me, Sending sending, Supplier<MessageView> insert,
			Function<Message, MessageView> same) {
		try {
			return run(insert);
		}
		catch (DataIntegrityViolationException ex) {
			if (!isDuplicateClientId(ex)) {
				throw ex;
			}
			return run(() -> this.messages.findByUserIdAndClientId(me, sending.clientId())
				.map(same)
				.orElseThrow(() -> ex));
		}
	}

	// 送るときの入力（FN-07 4 章）。添付があれば本文は空でもよい
	private record Sending(String body, UUID clientId, List<Long> attachmentIds) {

		static Sending of(@Nullable String rawBody, @Nullable String rawClientId,
				@Nullable List<Long> rawAttachmentIds) {
			UUID clientId = parseClientId(rawClientId);
			List<Long> attachmentIds = (rawAttachmentIds == null) ? List.of() : rawAttachmentIds;
			Attachments.requireAtMostFour(attachmentIds);
			return new Sending(MessageBodies.valid(rawBody, !attachmentIds.isEmpty()), clientId, attachmentIds);
		}

	}

	// 返信の追加と親の件数の直しが、ほかの返信・削除と同時に起きても食い違わないよう、親の行をロックする（BR-8）
	private MessageView insertReply(long me, long parentId, String body, UUID clientId, List<Long> attachmentIds) {
		Message parent = this.messages.findByIdForUpdate(parentId).orElseThrow(MessageService::notFound);
		Conversation conversation = this.conversations.findVisible(me, parent.getConversationId())
			.orElseThrow(MessageService::notFound);
		if (parent.isReply()) {
			throw new ApiException(ErrorCode.CANNOT_REPLY_TO_REPLY);
		}
		Optional<Message> sent = this.messages.findByUserIdAndClientId(me, clientId);
		if (sent.isPresent()) {
			return sameReply(me, parentId, sent.get());
		}
		this.access.requireCanPost(me, conversation);
		Message reply = this.messages.saveAndFlush(Message.reply(parent, me, clientId, body, this.clock.instant()));
		this.attachments.attach(me, conversation.getId(), reply.getId(), attachmentIds);
		parent.replyAdded(reply.getCreatedAt());
		MessageView view = view(me, conversation, reply);
		// スレッドを開いている人のパネルに返信を足し、会話を開いている人の親の件数と時刻を変える（TH-3）
		notify(RealtimeEvent.Type.MESSAGE_CREATED, conversation, view.forEveryone());
		notify(RealtimeEvent.Type.MESSAGE_UPDATED, conversation, view(me, conversation, parent).forEveryone());
		if (conversation.getType() == Conversation.Type.DM) {
			this.directMessages.messageSent(conversation);
		}
		return view;
	}

	// 同じ clientId で前に送った返信。ほかの親への返信やメッセージと同じ clientId は、入力の誤りにする
	private MessageView sameReply(long me, long parentId, Message sent) {
		if (!Objects.equals(sent.getParentId(), parentId)) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "clientId");
		}
		return view(me, requireVisible(me, sent.getConversationId()), sent);
	}

	private MessageView insert(long me, long conversationId, String body, UUID clientId, List<Long> attachmentIds) {
		Conversation conversation = requireVisible(me, conversationId);
		Optional<Message> sent = this.messages.findByUserIdAndClientId(me, clientId);
		if (sent.isPresent()) {
			return sameSend(me, conversationId, sent.get());
		}
		this.access.requireCanPost(me, conversation);
		Message message = this.messages
			.saveAndFlush(new Message(conversationId, me, clientId, body, this.clock.instant()));
		this.attachments.attach(me, conversationId, message.getId(), attachmentIds);
		MessageView view = view(me, conversation, message);
		notify(RealtimeEvent.Type.MESSAGE_CREATED, conversation, view.forEveryone());
		if (conversation.getType() == Conversation.Type.DM) {
			this.directMessages.messageSent(conversation);
		}
		return view;
	}

	// 同じ clientId で前に送ったもの。同じ送信のやり直しなので、それを返す（その後で「削除されました」にしていれば、その状態で返す）。
	// ほかの会話に送ったものと同じ clientId は、画面が送信ごとに作り直すので起きない。起きたら入力の誤りにする
	private MessageView sameSend(long me, long conversationId, Message sent) {
		if (sent.getConversationId() != conversationId || sent.isReply()) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "clientId");
		}
		return view(me, requireVisible(me, conversationId), sent);
	}

	// 編集（MS-9）。送った本人だけ。オーナーでもほかの人のものは編集できない（MS-10）。
	// 送れるか（チャンネルのメンバーか）は確かめない。本人がワークスペースのメンバーで会話を見られる間は、
	// チャンネルから抜けた後でも自分のメッセージを直せる（FN-07 5 章の 5）。
	// 同時に「削除されました」にされたとき、消した本文を編集で戻さないよう、削除と同じく行をロックする。
	// keepAttachmentIds で残す添付を決め、ほかは外す（AT-9。null ならすべて残す）。本文が空で添付も残らないなら送れない
	@Transactional
	MessageView edit(long me, long messageId, @Nullable String rawBody, @Nullable List<Long> keepAttachmentIds) {
		String body = MessageBodies.valid(rawBody, true);
		Message message = this.messages.findByIdForUpdate(messageId).orElseThrow(MessageService::notFound);
		Conversation conversation = this.conversations.findVisible(me, message.getConversationId())
			.orElseThrow(MessageService::notFound);
		if (message.isDeleted()) {
			throw notFound();
		}
		if (message.getUserId() != me) {
			throw new ApiException(ErrorCode.NOT_AUTHOR);
		}
		int remaining = this.attachments.keepOnly(messageId, keepAttachmentIds);
		if (body.isEmpty() && remaining == 0) {
			throw new ApiException(ErrorCode.MESSAGE_EMPTY, "body");
		}
		message.edit(body, this.clock.instant());
		MessageView view = view(me, conversation, message);
		notify(RealtimeEvent.Type.MESSAGE_UPDATED, conversation, view.forEveryone());
		return view;
	}

	// 削除（MS-10・MS-11・TH-4）。送った本人とオーナーだけ。
	// 返信のある親メッセージは「削除されました」にして返し、それ以外はデータごと消して空を返す。
	// 返信を消したときは、親の件数と最後の返信の日時を直し、「削除されました」の親の返信がなくなったら親も消す（BR-8、TH-7）。
	// 返信の送信と同じ順（親 → 返信）で行をロックする
	@Transactional
	Optional<MessageView> delete(long me, long messageId) {
		Long parentId = this.messages.findById(messageId).map(Message::getParentId).orElse(null);
		Message parent = (parentId == null) ? null : this.messages.findByIdForUpdate(parentId).orElse(null);
		Message message = this.messages.findByIdForUpdate(messageId).orElseThrow(MessageService::notFound);
		Conversation conversation = this.conversations.findVisible(me, message.getConversationId())
			.orElseThrow(MessageService::notFound);
		if (message.isDeleted()) {
			throw notFound();
		}
		if (message.getUserId() != me && !isOwner(me, conversation)) {
			throw new ApiException(ErrorCode.FORBIDDEN);
		}
		this.attachments.removeAllOf(messageId);
		if (message.getReplyCount() > 0) {
			this.reactions.removeAllOf(messageId);
			message.markDeleted(this.clock.instant());
			MessageView view = view(me, conversation, message);
			notify(RealtimeEvent.Type.MESSAGE_UPDATED, conversation, view.forEveryone());
			return Optional.of(view);
		}
		this.messages.delete(message);
		this.messages.flush();
		notify(RealtimeEvent.Type.MESSAGE_DELETED, conversation,
				new RealtimeEvent.MessageDeleted(message.getId(), message.getParentId()));
		if (parent != null) {
			replyRemoved(me, conversation, parent);
		}
		return Optional.empty();
	}

	private void replyRemoved(long me, Conversation conversation, Message parent) {
		parent.replyRemoved(this.messages.findLastReplyAt(parent.getId()));
		if (parent.isDeleted() && parent.getReplyCount() == 0) {
			this.messages.delete(parent);
			notify(RealtimeEvent.Type.MESSAGE_DELETED, conversation,
					new RealtimeEvent.MessageDeleted(parent.getId(), null));
			return;
		}
		notify(RealtimeEvent.Type.MESSAGE_UPDATED, conversation, view(me, conversation, parent).forEveryone());
	}

	private void notify(RealtimeEvent.Type type, Conversation conversation, Object payload) {
		this.notifier.toConversation(type, conversation.getWorkspaceId(), conversation.getId(), payload);
	}

	private Conversation requireVisible(long me, long conversationId) {
		return this.access.requireVisible(me, conversationId);
	}

	// ほかの人のメッセージを削除できるオーナーか。DM ではオーナーでも削除できない（オーナーは DM を見られない。FN-12 5 章の 6）
	private boolean isOwner(long me, Conversation conversation) {
		return conversation.getType() == Conversation.Type.CHANNEL
				&& this.workspaceAccess.requireMember(me, conversation.getWorkspaceId())
					.getRole() == WorkspaceMember.Role.OWNER;
	}

	private MessageView view(long me, Conversation conversation, Message message) {
		return views(me, conversation, List.of(message)).getFirst();
	}

	// 送った人・返信した人・添付・リアクションをまとめて読んでから MessageView にする
	private List<MessageView> views(long me, Conversation conversation, List<Message> list) {
		if (list.isEmpty()) {
			return List.of();
		}
		boolean owner = isOwner(me, conversation);
		Instant now = this.clock.instant();
		Map<Long, List<Long>> repliers = repliers(list);
		Set<Long> userIds = new HashSet<>(list.stream().map(Message::getUserId).toList());
		repliers.values().forEach(userIds::addAll);
		Map<Long, UserSummary> users = this.users.findAllById(userIds)
			.stream()
			.collect(Collectors.toMap(User::getId, (u) -> this.userSummaries.of(u, now)));
		List<Long> ids = list.stream().map(Message::getId).toList();
		Map<Long, List<AttachmentView>> attached = this.attachments.views(ids);
		Map<Long, List<ReactionView>> reacted = this.reactions.views(me, ids);
		return list.stream()
			.map((m) -> MessageView.of(m, users.get(m.getUserId()), attached.getOrDefault(m.getId(), List.of()),
					reacted.getOrDefault(m.getId(), List.of()),
					repliers.getOrDefault(m.getId(), List.of()).stream().map(users::get).toList(), me, owner))
			.toList();
	}

	// 返信のある親メッセージごとに、最後に返信した人から MAX_REPLY_USERS 人（画面設計書 2.9 の返信した人のアバター）
	private Map<Long, List<Long>> repliers(List<Message> list) {
		List<Long> parents = list.stream().filter((m) -> m.getReplyCount() > 0).map(Message::getId).toList();
		if (parents.isEmpty()) {
			return Map.of();
		}
		return this.messages.findRepliers(parents)
			.stream()
			.sorted(Comparator.comparingLong(MessageRepository.Replier::lastReplyId).reversed())
			.collect(Collectors.groupingBy(MessageRepository.Replier::parentId,
					Collectors.mapping(MessageRepository.Replier::userId, Collectors.toList())))
			.entrySet()
			.stream()
			.collect(Collectors.toMap(Map.Entry::getKey,
					(e) -> e.getValue().subList(0, Math.min(MAX_REPLY_USERS, e.getValue().size()))));
	}

	private <T> T run(Supplier<T> action) {
		T result = this.transaction.execute((status) -> action.get());
		if (result == null) {
			throw new IllegalStateException("トランザクションの結果がありません");
		}
		return result;
	}

	// 一意の制約（user_id, client_id）に反したか。例外の文はドライバの言語設定で変わるので、制約の名前で比べる
	private static boolean isDuplicateClientId(DataIntegrityViolationException ex) {
		for (Throwable cause = ex; cause != null; cause = cause.getCause()) {
			if (cause instanceof ConstraintViolationException violation) {
				return CLIENT_ID_CONSTRAINT.equals(violation.getConstraintName());
			}
		}
		return false;
	}

	private static UUID parseClientId(@Nullable String raw) {
		try {
			if (raw != null && raw.length() == 36) {
				return UUID.fromString(raw);
			}
		}
		catch (IllegalArgumentException ex) {
			// 下で 400 にする
		}
		throw new ApiException(ErrorCode.BAD_REQUEST, "clientId");
	}

	private static long first(List<Message> list) {
		return list.getFirst().getId();
	}

	private static long last(List<Message> list) {
		return list.getLast().getId();
	}

	private static ApiException notFound() {
		return new ApiException(ErrorCode.MESSAGE_NOT_FOUND);
	}

	// メッセージの一覧の結果（FN-07 6 章）
	record MessagePage(List<MessageView> items, boolean hasMoreBefore, boolean hasMoreAfter) {
	}

	// スレッドの返信の一覧の結果（FN-08 6 章）
	record ReplyPage(MessageView parent, List<MessageView> items, boolean hasMoreBefore, boolean hasMoreAfter) {
	}

}
