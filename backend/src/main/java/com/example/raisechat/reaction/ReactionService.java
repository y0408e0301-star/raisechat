package com.example.raisechat.reaction;

import java.time.Clock;
import java.util.List;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.conversation.Conversation;
import com.example.raisechat.conversation.ConversationAccess;
import com.example.raisechat.conversation.ConversationRepository;
import com.example.raisechat.emoji.Emojis;
import com.example.raisechat.message.Message;
import com.example.raisechat.message.MessageRepository;
import com.example.raisechat.realtime.RealtimeEvent;
import com.example.raisechat.realtime.RealtimeNotifier;

// リアクションを付ける・外す（機能定義書 FN-10）。どちらも何度送っても同じ結果になる（5 章の 1）。
// メッセージの行をロックしてから確かめる。同時に付けても 50 種類を超えず（BR-10）、
// 同時に「削除されました」にされたメッセージに付けない（削除も同じ行をロックする。BR-8）
@Service
class ReactionService {

	// 1 つのメッセージに付けられる絵文字の種類（データ要件定義書 6.2）
	static final int MAX_EMOJIS = 50;

	private final ReactionRepository reactions;

	private final Reactions views;

	private final MessageRepository messages;

	private final ConversationRepository conversations;

	private final ConversationAccess access;

	private final Emojis emojis;

	private final Clock clock;

	private final RealtimeNotifier notifier;

	ReactionService(ReactionRepository reactions, Reactions views, MessageRepository messages,
			ConversationRepository conversations, ConversationAccess access, Emojis emojis, Clock clock,
			RealtimeNotifier notifier) {
		this.reactions = reactions;
		this.views = views;
		this.messages = messages;
		this.conversations = conversations;
		this.access = access;
		this.emojis = emojis;
		this.clock = clock;
		this.notifier = notifier;
	}

	// 付ける（RE-1・RE-3）。もう付けていれば何もしない
	@Transactional
	List<ReactionView> add(long me, long messageId, @Nullable String rawEmoji) {
		String emoji = valid(rawEmoji);
		Target target = lock(me, messageId);
		if (!this.reactions.existsById(new Reaction.Key(messageId, me, emoji))) {
			// 種類の上限は、まだ付いていない絵文字を足すときだけ確かめる（RE-7）
			if (!this.reactions.existsByMessageIdAndEmoji(messageId, emoji)
					&& this.reactions.countEmojis(messageId) >= MAX_EMOJIS) {
				throw new ApiException(ErrorCode.REACTION_LIMIT);
			}
			this.reactions.saveAndFlush(new Reaction(messageId, me, emoji, this.clock.instant()));
		}
		return changed(me, target);
	}

	// 外す（RE-3）。付けていなければ何もしない。外せるのは自分のものだけ（8 章）
	@Transactional
	List<ReactionView> remove(long me, long messageId, @Nullable String rawEmoji) {
		String emoji = valid(rawEmoji);
		Target target = lock(me, messageId);
		this.reactions.findById(new Reaction.Key(messageId, me, emoji)).ifPresent((r) -> {
			this.reactions.delete(r);
			this.reactions.flush();
		});
		return changed(me, target);
	}

	private String valid(@Nullable String raw) {
		String emoji = this.emojis.normalize(raw);
		if (emoji == null) {
			throw new ApiException(ErrorCode.EMOJI_INVALID, "emoji");
		}
		return emoji;
	}

	// 見られなければ 404、送れなければ 403（8 章）、「削除されました」なら 403
	private Target lock(long me, long messageId) {
		Message message = this.messages.findByIdForUpdate(messageId)
			.orElseThrow(() -> new ApiException(ErrorCode.MESSAGE_NOT_FOUND));
		Conversation conversation = this.conversations.findVisible(me, message.getConversationId())
			.orElseThrow(() -> new ApiException(ErrorCode.MESSAGE_NOT_FOUND));
		this.access.requireCanPost(me, conversation);
		if (message.isDeleted()) {
			throw new ApiException(ErrorCode.MESSAGE_DELETED);
		}
		return new Target(message, conversation);
	}

	// そのメッセージのリアクション全体を返し、コミットの後で会話を見ている人に送る（5 章の 3）。
	// 変わらなかったときも送る（ほかの人の画面が先に変えた表示を、最後の状態に合わせる）
	private List<ReactionView> changed(long me, Target target) {
		List<ReactionView> current = this.views.viewsOf(me, target.message().getId());
		this.notifier.toConversation(RealtimeEvent.Type.REACTION_UPDATED, target.conversation().getWorkspaceId(),
				target.conversation().getId(), new RealtimeEvent.ReactionUpdated(target.message().getId(),
						current.stream().map(ReactionView::forEveryone).toList()));
		return current;
	}

	private record Target(Message message, Conversation conversation) {
	}

}
