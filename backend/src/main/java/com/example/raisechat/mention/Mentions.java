package com.example.raisechat.mention;

import java.time.Clock;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;

import com.example.raisechat.conversation.Conversation;
import com.example.raisechat.user.User;
import com.example.raisechat.user.UserName;

// メッセージ（FN-07・FN-08）から使うメンションの操作（FN-11）。呼ぶ側のトランザクションの中で使う。
// メンションされた人への知らせ（件数・一覧・ブラウザの通知。MN-5）は 1-15 で足す
@Component
public class Mentions {

	private final MentionRepository mentions;

	private final Clock clock;

	Mentions(MentionRepository mentions, Clock clock) {
		this.mentions = mentions;
		this.clock = clock;
	}

	// 送ったメッセージのメンションを記録する（3.2）。自分・いない人・その会話を見られない人は記録しない（MN-4）。
	// 記録した人を返す（知らせる相手。MN-5）
	public Set<Long> record(long me, Conversation conversation, long messageId, String body) {
		Set<Long> mentioned = mentionable(me, conversation, body);
		for (long userId : mentioned) {
			this.mentions.save(new Mention(messageId, userId, this.clock.instant()));
		}
		return mentioned;
	}

	// 編集したとき（MN-6、5 章の 4）。増えた人を足し、減った人を消す。残った人の「読んだか」は変えない
	public Change update(long me, Conversation conversation, long messageId, String body) {
		Set<Long> now = mentionable(me, conversation, body);
		Set<Long> before = userIdsOf(messageId);
		List<Long> removed = before.stream().filter((id) -> !now.contains(id)).toList();
		if (!removed.isEmpty()) {
			this.mentions.deleteUsers(messageId, removed);
		}
		List<Long> added = now.stream().filter((id) -> !before.contains(id)).toList();
		for (long userId : added) {
			this.mentions.save(new Mention(messageId, userId, this.clock.instant()));
		}
		return new Change(Set.copyOf(added), Set.copyOf(removed));
	}

	// 編集で足した人・消した人
	public record Change(Set<Long> added, Set<Long> removed) {
	}

	// そのメッセージでメンションされている人
	public Set<Long> userIdsOf(long messageId) {
		return new HashSet<>(this.mentions.findByMessageId(messageId).stream().map(Mention::getUserId).toList());
	}

	// メッセージを「削除されました」にするとき（MS-11、BR-8）。データごと消すときは ON DELETE CASCADE で消える
	public void removeAllOf(long messageId) {
		this.mentions.deleteByMessageId(messageId);
	}

	// 会話を読んだ：その会話の親メッセージのうち ID が upTo 以下のものの、自分あてのメンションを読んだことにする（BR-15）
	public void markReadInConversation(long me, long conversationId, long upTo) {
		this.mentions.markReadInConversation(me, conversationId, upTo);
	}

	// スレッドを開いた：そのスレッドの返信の中の、自分あてのメンションを読んだことにする（BR-15）
	public void markReadInThread(long me, long parentId) {
		this.mentions.markReadInThread(me, parentId);
	}

	// メッセージごとの、メンションした人（MessageView の mentions。画面はこの人の「@ユーザー ID」だけを目立たせる。5 章の 5）
	public Map<Long, List<UserName>> views(Collection<Long> messageIds) {
		Map<Long, List<UserName>> views = new LinkedHashMap<>();
		if (messageIds.isEmpty()) {
			return views;
		}
		for (MentionRepository.Row row : this.mentions.findRows(messageIds)) {
			views.computeIfAbsent(row.messageId(), (id) -> new ArrayList<>())
				.add(new UserName(row.username(), row.displayName()));
		}
		return views;
	}

	// 本文の「@ユーザー ID」のうち、記録する人の ID
	private Set<Long> mentionable(long me, Conversation conversation, String body) {
		Set<String> usernames = MentionSyntax.usernames(body);
		Set<Long> ids = new HashSet<>();
		if (usernames.isEmpty()) {
			return ids;
		}
		for (User user : this.mentions.findVisibleUsers(conversation.getId(), usernames)) {
			if (user.getId() != me) {
				ids.add(user.getId());
			}
		}
		return ids;
	}

}
