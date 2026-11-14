package com.example.raisechat.attachment;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

interface AttachmentRepository extends JpaRepository<Attachment, Long> {

	// complete と送信で、同時に同じ添付を扱っても状態を取りこぼさないよう行をロックする
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select a from Attachment a where a.id = :id")
	Optional<Attachment> findByIdForUpdate(@Param("id") long id);

	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select a from Attachment a where a.id in :ids order by a.id")
	List<Attachment> findAllByIdForUpdate(@Param("ids") Collection<Long> ids);

	@Query("select a from Attachment a where a.messageId in :messageIds order by a.messageId, a.sortOrder")
	List<Attachment> findByMessageIds(@Param("messageIds") Collection<Long> messageIds);

	@Query("select a from Attachment a where a.messageId = :messageId order by a.sortOrder")
	List<Attachment> findByMessageId(@Param("messageId") long messageId);

	List<Attachment> findByConversationId(long conversationId);

	@Query("""
			select a from Attachment a
			where a.conversationId in (select c.id from Conversation c where c.workspaceId = :workspaceId)""")
	List<Attachment> findByWorkspaceId(@Param("workspaceId") long workspaceId);

	// 送らずに 24 時間たったもの（BR-13）。同じときに送信で結びつけているもの（行をロックしている）は、
	// ロックが外れるのを待ち、message_id が入っていれば読まない（PostgreSQL は待った後で条件を確かめ直す）
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select a from Attachment a where a.messageId is null and a.createdAt < :before")
	List<Attachment> findUnsentBefore(@Param("before") Instant before);

}
