package com.example.raisechat.mention;

import java.util.Collection;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.example.raisechat.conversation.ConversationRepository;
import com.example.raisechat.user.User;

interface MentionRepository extends JpaRepository<Mention, Mention.Key> {

	// メッセージごとの、メンションした人（MessageView の mentions）
	@Query("""
			select new com.example.raisechat.mention.MentionRepository$Row(m.messageId, u.username, u.displayName)
			from Mention m join User u on u.id = m.userId
			where m.messageId in :messageIds
			order by m.messageId, m.createdAt, m.userId
			""")
	List<Row> findRows(@Param("messageIds") Collection<Long> messageIds);

	record Row(long messageId, String username, String displayName) {
	}

	List<Mention> findByMessageId(long messageId);

	@Modifying(flushAutomatically = true)
	@Query("delete from Mention m where m.messageId = :messageId")
	void deleteByMessageId(@Param("messageId") long messageId);

	@Modifying(flushAutomatically = true)
	@Query("delete from Mention m where m.messageId = :messageId and m.userId in :userIds")
	void deleteUsers(@Param("messageId") long messageId, @Param("userIds") Collection<Long> userIds);

	// ユーザー ID（小文字）の人のうち、いまその会話を見られる人（FN-11 5 章の 2）
	@Query(value = """
			SELECT u.* FROM users u, conversations c
			WHERE c.id = :conversationId AND lower(u.username) IN (:usernames)
			  AND\s""" + ConversationRepository.VISIBLE_TO_USER, nativeQuery = true)
	List<User> findVisibleUsers(@Param("conversationId") long conversationId,
			@Param("usernames") Collection<String> usernames);

	// メンションの候補（MN-1）：その会話を見られる人（自分を除く）のうち、表示名かユーザー ID に :pattern（LIKE の形）を含む人。
	// 会話のメンバーを先に、表示名の順に
	@Query(value = """
			SELECT u.id AS "id",
			       EXISTS (SELECT 1 FROM conversation_members m
			               WHERE m.conversation_id = c.id AND m.user_id = u.id) AS "member"
			FROM users u, conversations c
			WHERE c.id = :conversationId AND u.id <> :me
			  AND (lower(u.display_name) LIKE lower(:pattern) ESCAPE '\\' OR lower(u.username) LIKE lower(:pattern) ESCAPE '\\')
			  AND\s"""
			+ ConversationRepository.VISIBLE_TO_USER + """
					ORDER BY "member" DESC, lower(u.display_name), u.id
					LIMIT :limit
					""", nativeQuery = true)
	List<CandidateRow> findCandidates(@Param("me") long me, @Param("conversationId") long conversationId,
			@Param("pattern") String pattern, @Param("limit") int limit);

	interface CandidateRow {

		long getId();

		boolean getMember();

	}

}
