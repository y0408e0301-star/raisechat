package com.example.raisechat.conversation;

import java.util.Collection;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;

import com.example.raisechat.realtime.RealtimeEvent;
import com.example.raisechat.realtime.RealtimeNotifier;
import com.example.raisechat.unread.UnreadCounts;
import com.example.raisechat.workspace.WorkspaceMemberRepository;

// 未読・メンションの件数が変わった人に知らせる（機能定義書 FN-14 6 章の conversation.updated・workspace.updated、NT-6）。
// メッセージの送信・編集・削除（FN-07・FN-08・FN-11）、既読、チャンネルからの退出・削除で使う。
// 呼ぶ側のトランザクションの中で数え（その変更を含めて数える）、コミットの後で送る
@Component
public class CountNotices {

	private final UnreadCounts unreadCounts;

	private final WorkspaceMemberRepository workspaceMembers;

	private final DirectMessages directMessages;

	private final RealtimeNotifier notifier;

	CountNotices(UnreadCounts unreadCounts, WorkspaceMemberRepository workspaceMembers, DirectMessages directMessages,
			RealtimeNotifier notifier) {
		this.unreadCounts = unreadCounts;
		this.workspaceMembers = workspaceMembers;
		this.directMessages = directMessages;
		this.notifier = notifier;
	}

	// users の、会話の件数（サイドバーの行）とワークスペースの合計を送る。
	// 会話のメンバーでない人（参加していない公開チャンネル）には合計だけを送る。DM はサイドバーに出ている人にだけ行を送る
	// （DM にメッセージが届くと、サイドバーの並びも変わる。DM-1）
	public void changed(Conversation conversation, Collection<Long> users) {
		if (users.isEmpty()) {
			return;
		}
		Map<Long, UnreadCounts.Counts> counts = this.unreadCounts.ofMembers(conversation.getId(), users);
		for (Map.Entry<Long, UnreadCounts.Counts> entry : counts.entrySet()) {
			long userId = entry.getKey();
			ConversationSummary summary;
			if (conversation.getType() == Conversation.Type.DM) {
				if (!this.directMessages.inSidebarOf(conversation, userId)) {
					continue;
				}
				summary = this.directMessages.summary(conversation, userId);
			}
			else {
				summary = ConversationSummary.of(conversation, true).withCounts(entry.getValue());
			}
			this.notifier.toUser(userId, RealtimeEvent.Type.CONVERSATION_UPDATED, conversation.getWorkspaceId(),
					conversation.getId(), summary);
		}
		workspaceChanged(conversation.getWorkspaceId(), users);
	}

	// users の、ワークスペースの合計（G-3 の印とヘッダーのメンションの件数）を送る。いまメンバーでない人には送らない
	public void workspaceChanged(long workspaceId, Collection<Long> users) {
		Set<Long> unique = new HashSet<>(users);
		this.unreadCounts.ofWorkspace(workspaceId, unique)
			.forEach((userId, counts) -> this.notifier.toUser(userId, RealtimeEvent.Type.WORKSPACE_UPDATED, workspaceId,
					null, new RealtimeEvent.WorkspaceUpdated(workspaceId, counts.hasUnread(), counts.mentionCount())));
	}

	// ワークスペースのメンバー全員の合計を送る（チャンネルを削除したとき。参加していない人へのメンションも消えるため）
	public void workspaceChangedForAll(long workspaceId) {
		workspaceChanged(workspaceId, this.workspaceMembers.findUserIds(workspaceId));
	}

}
