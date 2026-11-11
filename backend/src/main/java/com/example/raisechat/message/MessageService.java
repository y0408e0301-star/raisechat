package com.example.raisechat.message;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import org.hibernate.exception.ConstraintViolationException;
import org.jspecify.annotations.Nullable;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.conversation.Conversation;
import com.example.raisechat.conversation.ConversationMember;
import com.example.raisechat.conversation.ConversationMemberRepository;
import com.example.raisechat.conversation.ConversationRepository;
import com.example.raisechat.user.User;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.user.UserSummary;
import com.example.raisechat.workspace.WorkspaceAccess;
import com.example.raisechat.workspace.WorkspaceMember;

// メッセージの一覧・送信・編集・削除（機能定義書 FN-07）。
// リアルタイムの通知は 1-5、添付は 1-11、スレッドの返信は 1-12、メンションは 1-14 で足す
@Service
class MessageService {

	// 1 回に読み込む件数の上限と、指定がないときの件数（FN-07 6 章）
	static final int MAX_LIMIT = 50;

	// 同じ人が同じ clientId で 2 回追加しないための一意の制約の名前（V3__create_messages.sql）
	private static final String CLIENT_ID_CONSTRAINT = "messages_user_client_key";

	private final MessageRepository messages;

	private final ConversationRepository conversations;

	private final ConversationMemberRepository conversationMembers;

	private final WorkspaceAccess workspaceAccess;

	private final UserRepository users;

	private final Clock clock;

	private final TransactionTemplate transaction;

	MessageService(MessageRepository messages, ConversationRepository conversations,
			ConversationMemberRepository conversationMembers, WorkspaceAccess workspaceAccess, UserRepository users,
			Clock clock, TransactionTemplate transaction) {
		this.messages = messages;
		this.conversations = conversations;
		this.conversationMembers = conversationMembers;
		this.workspaceAccess = workspaceAccess;
		this.users = users;
		this.clock = clock;
		this.transaction = transaction;
	}

	// 会話のメッセージの一覧（MS-1・MS-2）。before・after のどちらか、またはなし（最新）。古い順に返す
	@Transactional(readOnly = true)
	MessagePage list(long me, long conversationId, @Nullable Long before, @Nullable Long after,
			@Nullable Integer rawLimit) {
		if (before != null && after != null) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "before");
		}
		int limit = (rawLimit == null) ? MAX_LIMIT : rawLimit;
		if (limit < 1 || limit > MAX_LIMIT) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "limit");
		}
		Conversation conversation = requireVisible(me, conversationId);
		// 1 件多く読んで、続きがあるかを知る
		Limit plusOne = Limit.of(limit + 1);
		List<Message> found;
		boolean hasMoreBefore;
		boolean hasMoreAfter;
		if (after != null) {
			found = new ArrayList<>(this.messages.findAfter(conversationId, after, plusOne));
			hasMoreAfter = found.size() > limit;
			found = found.subList(0, Math.min(limit, found.size()));
			hasMoreBefore = this.messages.existsBefore(conversationId, found.isEmpty() ? after + 1 : first(found));
		}
		else {
			found = new ArrayList<>((before != null) ? this.messages.findBefore(conversationId, before, plusOne)
					: this.messages.findLatest(conversationId, plusOne));
			hasMoreBefore = found.size() > limit;
			found = new ArrayList<>(found.subList(0, Math.min(limit, found.size())));
			Collections.reverse(found);
			hasMoreAfter = (before != null)
					&& this.messages.existsAfter(conversationId, found.isEmpty() ? before - 1 : last(found));
		}
		return new MessagePage(views(me, conversation, found), hasMoreBefore, hasMoreAfter);
	}

	// 送る（MS-3）。同じ clientId で 2 回送られたときは、2 つ目を追加せず 1 つ目を返す（FN-07 5 章の 8）
	MessageView post(long me, long conversationId, @Nullable String rawBody, @Nullable String rawClientId) {
		UUID clientId = parseClientId(rawClientId);
		String body = MessageBodies.valid(rawBody);
		try {
			return run(() -> insert(me, conversationId, body, clientId));
		}
		catch (DataIntegrityViolationException ex) {
			// 同じ clientId が同時に送られ、もう一方が先に追加した（一意の制約）。それ以外の失敗はそのまま投げる
			if (!isDuplicateClientId(ex)) {
				throw ex;
			}
			return run(() -> this.messages.findByUserIdAndClientId(me, clientId)
				.map((m) -> sameSend(me, conversationId, m))
				.orElseThrow(() -> ex));
		}
	}

	private MessageView insert(long me, long conversationId, String body, UUID clientId) {
		Conversation conversation = requireVisible(me, conversationId);
		Optional<Message> sent = this.messages.findByUserIdAndClientId(me, clientId);
		if (sent.isPresent()) {
			return sameSend(me, conversationId, sent.get());
		}
		requireCanPost(me, conversation);
		Message message = this.messages
			.saveAndFlush(new Message(conversationId, me, clientId, body, this.clock.instant()));
		return view(me, conversation, message);
	}

	// 同じ clientId で前に送ったもの。同じ送信のやり直しなので、それを返す。
	// ほかの会話に送ったものと同じ clientId は、画面が送信ごとに作り直すので起きない。起きたら入力の誤りにする
	private MessageView sameSend(long me, long conversationId, Message sent) {
		if (sent.getConversationId() != conversationId) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "clientId");
		}
		return view(me, requireVisible(me, conversationId), sent);
	}

	// 編集（MS-9）。送った本人だけ。オーナーでもほかの人のものは編集できない（MS-10）。
	// 送れるか（チャンネルのメンバーか）は確かめない。本人がワークスペースのメンバーで会話を見られる間は、
	// チャンネルから抜けた後でも自分のメッセージを直せる（FN-07 5 章の 5）
	@Transactional
	MessageView edit(long me, long messageId, @Nullable String rawBody) {
		String body = MessageBodies.valid(rawBody);
		Message message = this.messages.findById(messageId).orElseThrow(MessageService::notFound);
		Conversation conversation = this.conversations.findVisible(me, message.getConversationId())
			.orElseThrow(MessageService::notFound);
		if (message.isDeleted()) {
			throw notFound();
		}
		if (message.getUserId() != me) {
			throw new ApiException(ErrorCode.NOT_AUTHOR);
		}
		message.edit(body, this.clock.instant());
		return view(me, conversation, message);
	}

	// 削除（MS-10・MS-11）。送った本人とオーナーだけ。
	// 返信のある親メッセージは「削除されました」にして返し、それ以外はデータごと消して空を返す。
	// 返信を消したときの親の件数の直し（BR-8）は、スレッド（開発計画書 1-12）で足す
	@Transactional
	Optional<MessageView> delete(long me, long messageId) {
		Message message = this.messages.findByIdForUpdate(messageId).orElseThrow(MessageService::notFound);
		Conversation conversation = this.conversations.findVisible(me, message.getConversationId())
			.orElseThrow(MessageService::notFound);
		if (message.isDeleted()) {
			throw notFound();
		}
		if (message.getUserId() != me && !isOwner(me, conversation)) {
			throw new ApiException(ErrorCode.FORBIDDEN);
		}
		if (message.getReplyCount() > 0) {
			message.markDeleted(this.clock.instant());
			return Optional.of(view(me, conversation, message));
		}
		this.messages.delete(message);
		return Optional.empty();
	}

	private Conversation requireVisible(long me, long conversationId) {
		return this.conversations.findVisible(me, conversationId)
			.orElseThrow(() -> new ApiException(ErrorCode.CONVERSATION_NOT_FOUND));
	}

	// 送れるか（ConversationSummary の canPost）。チャンネルはメンバーのときだけ。
	// DM の相手がワークスペースを抜けたときの確かめ（DM_PARTNER_LEFT）は DM（開発計画書 1-9）で足す
	private void requireCanPost(long me, Conversation conversation) {
		if (conversation.getType() == Conversation.Type.CHANNEL
				&& !this.conversationMembers.existsById(new ConversationMember.Key(conversation.getId(), me))) {
			throw new ApiException(ErrorCode.NOT_CHANNEL_MEMBER);
		}
	}

	private boolean isOwner(long me, Conversation conversation) {
		return this.workspaceAccess.requireMember(me, conversation.getWorkspaceId())
			.getRole() == WorkspaceMember.Role.OWNER;
	}

	private MessageView view(long me, Conversation conversation, Message message) {
		return views(me, conversation, List.of(message)).getFirst();
	}

	// 送った人をまとめて読んでから MessageView にする
	private List<MessageView> views(long me, Conversation conversation, List<Message> list) {
		if (list.isEmpty()) {
			return List.of();
		}
		boolean owner = isOwner(me, conversation);
		Instant now = this.clock.instant();
		Map<Long, UserSummary> authors = this.users
			.findAllById(list.stream().map(Message::getUserId).distinct().toList())
			.stream()
			.collect(Collectors.toMap(User::getId, (u) -> UserSummary.of(u, now)));
		return list.stream().map((m) -> MessageView.of(m, authors.get(m.getUserId()), me, owner)).toList();
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

}
