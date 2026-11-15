package com.example.raisechat.unread;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.example.raisechat.conversation.ConversationRepository;

import jakarta.persistence.EntityManager;

// 未読とメンションの件数（機能定義書 FN-14 5 章の 1・2、データ設計書 8.2）。
// サイドバー（ConversationSummary）・G-3 とヘッダー（WorkspaceSummary）と、件数が変わったときの通知で使う。
// どれも、いまワークスペースのメンバーである人の分だけを数える（キック・退出した人の DM の行が残るため。BR-9）。
// JPA を通さずに数えるので、同じトランザクションでまだ書き出していない変更（メンションの記録など）は、数える前に書き出す
@Component
public class UnreadCounts {

	// 未読をこの数まで数える（100 以上は画面で「99+」。FN-14 5 章の 1）
	public static final int UNREAD_LIMIT = 100;

	// 会話のメンバー cm の、その会話の未読（親メッセージのうち、最後に読んだものより後で、自分以外が送り、「削除されました」でないもの）と、
	// 読んでいないメンション（スレッドの返信の中のものも数える。NT-2）。
	// 要件定義書 11.1 の件数で測って、次の形にした（データ設計書 8.2）。未読は親メッセージだけの部分索引を
	// 範囲で読む（返信の多い会話でも返信を読まない）。メンションは読んでいないものから 1 件ずつ主キーで
	// メッセージを引く（LIMIT 1 の LATERAL で、会話のメッセージを全部読む結合にしない）
	private static final String MEMBER_COUNTS = """
			SELECT cm.conversation_id AS conversation_id, cm.user_id AS user_id,
			       (SELECT count(*) FROM (
			            SELECT 1 FROM messages m
			            WHERE m.conversation_id = cm.conversation_id AND m.parent_id IS NULL AND m.deleted_at IS NULL
			              AND m.id > cm.last_read_message_id AND m.user_id <> cm.user_id
			            LIMIT\s""" + UNREAD_LIMIT + """
			            ) x) AS unread_count,
			       (SELECT count(*) FROM mentions mn
			        CROSS JOIN LATERAL (SELECT 1 FROM messages m
			                            WHERE m.id = mn.message_id AND m.conversation_id = cm.conversation_id LIMIT 1) x
			        WHERE mn.user_id = cm.user_id AND NOT mn.is_read) AS mention_count
			FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
			WHERE EXISTS (SELECT 1 FROM workspace_members wm2
			              WHERE wm2.workspace_id = c.workspace_id AND wm2.user_id = cm.user_id)
			""";

	// ワークスペースのメンバー wm の、未読がある会話があるか（G-3 の太字。NT-3）と、読んでいないメンションの合計
	// （参加していない公開チャンネルの分も含め、いま見られる会話のもの。5 章の 2・4）。
	// 未読は会話ごとに 1 件あるかだけを部分索引で確かめ、メンションは上と同じく読んでいないものから 1 件ずつ確かめる
	private static final String WORKSPACE_COUNTS = """
			SELECT wm.workspace_id AS workspace_id, wm.user_id AS user_id,
			       EXISTS (SELECT 1 FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
			               CROSS JOIN LATERAL (
			                   SELECT 1 FROM messages m
			                   WHERE m.conversation_id = cm.conversation_id AND m.parent_id IS NULL AND m.deleted_at IS NULL
			                     AND m.id > cm.last_read_message_id AND m.user_id <> cm.user_id
			                   LIMIT 1) unread
			               WHERE cm.user_id = wm.user_id AND c.workspace_id = wm.workspace_id) AS has_unread,
			       (SELECT count(*) FROM mentions mn
			        CROSS JOIN LATERAL (
			            SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN users u ON u.id = mn.user_id
			            WHERE m.id = mn.message_id AND c.workspace_id = wm.workspace_id
			              AND\s"""
			+ ConversationRepository.VISIBLE_TO_USER + """
					            LIMIT 1) x
					        WHERE mn.user_id = wm.user_id AND NOT mn.is_read) AS mention_count
					FROM workspace_members wm
					""";

	private final NamedParameterJdbcTemplate jdbc;

	private final EntityManager entityManager;

	UnreadCounts(NamedParameterJdbcTemplate jdbc, EntityManager entityManager) {
		this.jdbc = jdbc;
		this.entityManager = entityManager;
	}

	private void flush() {
		if (TransactionSynchronizationManager.isActualTransactionActive()
				&& !TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
			this.entityManager.flush();
		}
	}

	// me の会話ごとの件数。me がメンバーでない会話（参加していない公開チャンネル）は入らない
	public Map<Long, Counts> ofConversations(long me, Collection<Long> conversationIds) {
		flush();
		Map<Long, Counts> counts = new HashMap<>();
		if (conversationIds.isEmpty()) {
			return counts;
		}
		this.jdbc.query(MEMBER_COUNTS + " AND cm.user_id = :me AND cm.conversation_id IN (:ids)",
				new MapSqlParameterSource("me", me).addValue("ids", conversationIds), (rs) -> {
					counts.put(rs.getLong("conversation_id"),
							new Counts(rs.getInt("unread_count"), rs.getInt("mention_count")));
				});
		return counts;
	}

	public Counts ofConversation(long me, long conversationId) {
		return ofConversations(me, List.of(conversationId)).getOrDefault(conversationId, Counts.NONE);
	}

	// 会話のメンバーのうち users の件数（件数が変わった人への通知。FN-14 6 章）
	public Map<Long, Counts> ofMembers(long conversationId, Collection<Long> users) {
		flush();
		Map<Long, Counts> counts = new HashMap<>();
		if (users.isEmpty()) {
			return counts;
		}
		this.jdbc.query(MEMBER_COUNTS + " AND cm.conversation_id = :conversationId AND cm.user_id IN (:users)",
				new MapSqlParameterSource("conversationId", conversationId).addValue("users", users), (rs) -> {
					counts.put(rs.getLong("user_id"),
							new Counts(rs.getInt("unread_count"), rs.getInt("mention_count")));
				});
		return counts;
	}

	// ワークスペースのメンバーのうち users の合計。メンバーでない人は入らない
	public Map<Long, WorkspaceCounts> ofWorkspace(long workspaceId, Collection<Long> users) {
		flush();
		Map<Long, WorkspaceCounts> counts = new HashMap<>();
		if (users.isEmpty()) {
			return counts;
		}
		this.jdbc.query(WORKSPACE_COUNTS + " WHERE wm.workspace_id = :workspaceId AND wm.user_id IN (:users)",
				new MapSqlParameterSource("workspaceId", workspaceId).addValue("users", users), (rs) -> {
					counts.put(rs.getLong("user_id"),
							new WorkspaceCounts(rs.getBoolean("has_unread"), rs.getInt("mention_count")));
				});
		return counts;
	}

	// me のワークスペースごとの合計（G-3。NT-3）
	public Map<Long, WorkspaceCounts> ofWorkspaces(long me, Collection<Long> workspaceIds) {
		flush();
		Map<Long, WorkspaceCounts> counts = new HashMap<>();
		if (workspaceIds.isEmpty()) {
			return counts;
		}
		this.jdbc.query(WORKSPACE_COUNTS + " WHERE wm.user_id = :me AND wm.workspace_id IN (:ids)",
				new MapSqlParameterSource("me", me).addValue("ids", workspaceIds), (rs) -> {
					counts.put(rs.getLong("workspace_id"),
							new WorkspaceCounts(rs.getBoolean("has_unread"), rs.getInt("mention_count")));
				});
		return counts;
	}

	public WorkspaceCounts ofMember(long me, long workspaceId) {
		return ofWorkspaces(me, List.of(workspaceId)).getOrDefault(workspaceId, WorkspaceCounts.NONE);
	}

	// 会話の件数。unread は UNREAD_LIMIT まで
	public record Counts(int unread, int mentions) {

		public static final Counts NONE = new Counts(0, 0);

	}

	// ワークスペースの合計（workspace.updated の payload の中身）
	public record WorkspaceCounts(boolean hasUnread, int mentionCount) {

		public static final WorkspaceCounts NONE = new WorkspaceCounts(false, 0);

	}

}
