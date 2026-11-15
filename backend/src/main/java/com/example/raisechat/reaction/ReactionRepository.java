package com.example.raisechat.reaction;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface ReactionRepository extends JpaRepository<Reaction, Reaction.Key> {

	// メッセージごとに、付けた順に。付けた人の表示名も読む（RE-4）
	@Query("""
			select new com.example.raisechat.reaction.ReactionRepository$Row(
				r.messageId, r.emoji, r.userId, u.username, u.displayName, r.createdAt)
			from Reaction r join User u on u.id = r.userId
			where r.messageId in :messageIds
			order by r.messageId, r.createdAt, r.userId, r.emoji
			""")
	List<Row> findRows(@Param("messageIds") Collection<Long> messageIds);

	record Row(long messageId, String emoji, long userId, String username, String displayName, Instant createdAt) {
	}

	boolean existsByMessageIdAndEmoji(long messageId, String emoji);

	// 付いている絵文字の種類の数（上限 50。BR-10）
	@Query("select count(distinct r.emoji) from Reaction r where r.messageId = :messageId")
	long countEmojis(@Param("messageId") long messageId);

	@Modifying(flushAutomatically = true)
	@Query("delete from Reaction r where r.messageId = :messageId")
	void deleteByMessageId(@Param("messageId") long messageId);

}
