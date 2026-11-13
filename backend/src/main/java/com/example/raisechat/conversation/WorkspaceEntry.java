package com.example.raisechat.conversation;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Component;

import com.example.raisechat.message.MessageRepository;
import com.example.raisechat.realtime.RealtimeEvent;
import com.example.raisechat.realtime.RealtimeNotifier;

// 招待リンクでワークスペースに参加した人の会話（FN-04 I-5・I-8、BR-6）。
// general に入れ、前に入っていた DM（キック・退出しても行が残る。FN-05 MB-7）とあわせて、
// コミットの後に本人に conversation.updated を送る（ほかのタブのサイドバーのため）。
// DM の相手には、また送れるようになったことを知らせる（FN-05 MB-8）
@Component
public class WorkspaceEntry {

	private final ConversationRepository conversations;

	private final ConversationMemberRepository members;

	private final MessageRepository messages;

	private final RealtimeNotifier notifier;

	private final DirectMessages directMessages;

	private final Clock clock;

	WorkspaceEntry(ConversationRepository conversations, ConversationMemberRepository members,
			MessageRepository messages, RealtimeNotifier notifier, DirectMessages directMessages, Clock clock) {
		this.conversations = conversations;
		this.members = members;
		this.messages = messages;
		this.notifier = notifier;
		this.directMessages = directMessages;
		this.clock = clock;
	}

	// 呼ぶ側のトランザクションの中で使う。general の ID を返す
	public long enter(long userId, long workspaceId) {
		Conversation general = this.conversations.findGeneral(workspaceId).orElseThrow();
		// 参加する前のメッセージを未読にしない（BR-6）
		long latest = this.messages.findLatestId(general.getId());
		this.members.insertIfAbsent(general.getId(), userId, latest, this.clock.instant());
		List<ConversationSummary> joined = new ArrayList<>();
		joined.add(ConversationSummary.of(general, true));
		// サイドバーに出る DM だけ（メッセージがないものは、作った人のサイドバーにだけ出す）
		List<Conversation> dms = this.conversations.findJoinedDms(userId, workspaceId)
			.stream()
			.filter((dm) -> this.directMessages.inSidebarOf(dm, userId))
			.toList();
		joined.addAll(this.directMessages.summaries(dms, userId));
		for (ConversationSummary summary : joined) {
			this.notifier.toUser(userId, RealtimeEvent.Type.CONVERSATION_UPDATED, workspaceId, summary.id(), summary);
		}
		this.directMessages.membershipChanged(userId, workspaceId);
		return general.getId();
	}

}
