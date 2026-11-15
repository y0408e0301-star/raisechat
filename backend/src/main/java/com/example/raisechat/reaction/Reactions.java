package com.example.raisechat.reaction;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.example.raisechat.user.UserName;

// メッセージ（FN-07）から使うリアクションの操作（FN-10）。呼ぶ側のトランザクションの中で使う
@Component
public class Reactions {

	private final ReactionRepository reactions;

	Reactions(ReactionRepository reactions) {
		this.reactions = reactions;
	}

	// メッセージごとのリアクション。絵文字は最初に付けられた順（RE-5）、付けた人は付けた順（RE-4）
	public Map<Long, List<ReactionView>> views(long me, Collection<Long> messageIds) {
		Map<Long, List<ReactionView>> views = new LinkedHashMap<>();
		if (messageIds.isEmpty()) {
			return views;
		}
		Map<Long, Map<String, Tally>> tallies = new LinkedHashMap<>();
		for (ReactionRepository.Row row : this.reactions.findRows(messageIds)) {
			tallies.computeIfAbsent(row.messageId(), (id) -> new LinkedHashMap<>())
				.computeIfAbsent(row.emoji(), (emoji) -> new Tally())
				.add(row, me);
		}
		tallies.forEach((messageId, byEmoji) -> views.put(messageId,
				byEmoji.entrySet().stream().map((e) -> e.getValue().view(e.getKey())).toList()));
		return views;
	}

	public List<ReactionView> viewsOf(long me, long messageId) {
		return views(me, List.of(messageId)).getOrDefault(messageId, List.of());
	}

	// メッセージを「削除されました」にするとき（MS-11、BR-8）。データごと消すときは ON DELETE CASCADE で消える
	public void removeAllOf(long messageId) {
		this.reactions.deleteByMessageId(messageId);
	}

	private static final class Tally {

		private int count;

		private boolean mine;

		private final List<UserName> users = new ArrayList<>();

		void add(ReactionRepository.Row row, long me) {
			this.count++;
			this.mine |= row.userId() == me;
			if (this.users.size() < ReactionView.MAX_USERS) {
				this.users.add(new UserName(row.username(), row.displayName()));
			}
		}

		ReactionView view(String emoji) {
			return new ReactionView(emoji, this.count, this.mine, List.copyOf(this.users));
		}

	}

}
