package com.example.raisechat.conversation;

import java.time.Instant;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.example.raisechat.user.User;

public interface ConversationMemberRepository extends JpaRepository<ConversationMember, ConversationMember.Key> {

	long countByConversationId(long conversationId);

	// 会話のメンバーに足す。もう入っていれば何もしない（同じ人の参加が同時に 2 回来ても失敗しない）。足したら 1 を返す
	@Modifying
	@Query(value = """
			INSERT INTO conversation_members (conversation_id, user_id, last_read_message_id, joined_at)
			VALUES (:conversationId, :userId, :lastReadMessageId, :joinedAt)
			ON CONFLICT DO NOTHING
			""", nativeQuery = true)
	int insertIfAbsent(@Param("conversationId") long conversationId, @Param("userId") long userId,
			@Param("lastReadMessageId") long lastReadMessageId, @Param("joinedAt") Instant joinedAt);

	@Query("select m.userId from ConversationMember m where m.conversationId = :conversationId")
	List<Long> findUserIds(@Param("conversationId") long conversationId);

	// 会話のメンバー（CH-6）：表示名の順。:pattern は表示名かユーザー ID に含む文字（LIKE の形）。
	// 続きは (lower(display_name), id) が :afterName・:afterId より後ろの人
	@Query(value = """
			SELECT u.* FROM users u JOIN conversation_members m ON m.user_id = u.id
			WHERE m.conversation_id = :conversationId
			  AND (lower(u.display_name) LIKE :pattern ESCAPE '\\' OR lower(u.username) LIKE :pattern ESCAPE '\\')
			  AND (lower(u.display_name), u.id) > (lower(:afterName), :afterId)
			ORDER BY lower(u.display_name), u.id
			LIMIT :limit
			""", nativeQuery = true)
	List<User> findMembers(@Param("conversationId") long conversationId, @Param("pattern") String pattern,
			@Param("afterName") String afterName, @Param("afterId") long afterId, @Param("limit") int limit);

	// 招待の候補（CH-7）：ワークスペースのメンバーのうち、その会話にいない人を表示名の順に
	@Query(value = """
			SELECT u.* FROM users u JOIN workspace_members w ON w.user_id = u.id
			WHERE w.workspace_id = :workspaceId
			  AND NOT EXISTS (SELECT 1 FROM conversation_members m
			                  WHERE m.conversation_id = :conversationId AND m.user_id = u.id)
			  AND (lower(u.display_name) LIKE :pattern ESCAPE '\\' OR lower(u.username) LIKE :pattern ESCAPE '\\')
			ORDER BY lower(u.display_name), u.id
			LIMIT :limit
			""", nativeQuery = true)
	List<User> findCandidates(@Param("workspaceId") long workspaceId, @Param("conversationId") long conversationId,
			@Param("pattern") String pattern, @Param("limit") int limit);

	// 最後に読んだメッセージを進める。古い位置を送られても戻さない（FN-14 5 章の 3、BR-15）。
	// 参加していない公開チャンネルでは行がないので何もしない（未読を出さない。FN-14 5 章の 4）。
	// 同じトランザクションで後から会話のメンバーを読んでも古い値が残らないよう、更新の後で読み込んだものを捨てる
	@Modifying(flushAutomatically = true, clearAutomatically = true)
	@Query(value = """
			UPDATE conversation_members SET last_read_message_id = GREATEST(last_read_message_id, :messageId)
			WHERE conversation_id = :conversationId AND user_id = :userId
			""", nativeQuery = true)
	int advanceLastRead(@Param("conversationId") long conversationId, @Param("userId") long userId,
			@Param("messageId") long messageId);

}
