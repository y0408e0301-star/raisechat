package com.example.raisechat.message;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.jspecify.annotations.Nullable;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

// 会話のメッセージの一覧に出すのは親メッセージ（parent_id が null）だけ（FN-07 5 章の 3）
public interface MessageRepository extends JpaRepository<Message, Long> {

	// 最新から古い順に。画面には古い順に並べ直して返す
	@Query("""
			select m from Message m where m.conversationId = :conversationId and m.parentId is null
			order by m.id desc
			""")
	List<Message> findLatest(@Param("conversationId") long conversationId, Limit limit);

	// before より前を、新しい順に
	@Query("""
			select m from Message m where m.conversationId = :conversationId and m.parentId is null and m.id < :before
			order by m.id desc
			""")
	List<Message> findBefore(@Param("conversationId") long conversationId, @Param("before") long before, Limit limit);

	// after より後を、古い順に
	@Query("""
			select m from Message m where m.conversationId = :conversationId and m.parentId is null and m.id > :after
			order by m.id
			""")
	List<Message> findAfter(@Param("conversationId") long conversationId, @Param("after") long after, Limit limit);

	@Query("""
			select count(m) > 0 from Message m
			where m.conversationId = :conversationId and m.parentId is null and m.id > :after
			""")
	boolean existsAfter(@Param("conversationId") long conversationId, @Param("after") long after);

	@Query("""
			select count(m) > 0 from Message m
			where m.conversationId = :conversationId and m.parentId is null and m.id < :before
			""")
	boolean existsBefore(@Param("conversationId") long conversationId, @Param("before") long before);

	// スレッドの返信（FN-08 5 章の 5）。会話の一覧と同じく、最新から古い順に読み、画面には古い順に並べ直して返す
	@Query("select m from Message m where m.parentId = :parentId order by m.id desc")
	List<Message> findLatestReplies(@Param("parentId") long parentId, Limit limit);

	@Query("select m from Message m where m.parentId = :parentId and m.id < :before order by m.id desc")
	List<Message> findRepliesBefore(@Param("parentId") long parentId, @Param("before") long before, Limit limit);

	@Query("select m from Message m where m.parentId = :parentId and m.id > :after order by m.id")
	List<Message> findRepliesAfter(@Param("parentId") long parentId, @Param("after") long after, Limit limit);

	@Query("select count(m) > 0 from Message m where m.parentId = :parentId and m.id < :before")
	boolean existsReplyBefore(@Param("parentId") long parentId, @Param("before") long before);

	@Query("select count(m) > 0 from Message m where m.parentId = :parentId and m.id > :after")
	boolean existsReplyAfter(@Param("parentId") long parentId, @Param("after") long after);

	// 返信を消した後の、残った返信の最後の日時（BR-8）。なければ null
	@Query("select max(m.createdAt) from Message m where m.parentId = :parentId")
	@Nullable Instant findLastReplyAt(@Param("parentId") long parentId);

	// 親メッセージごとの、返信した人とその人の最後の返信の ID（画面設計書 2.9 の返信した人のアバター）
	@Query("""
			select new com.example.raisechat.message.MessageRepository$Replier(m.parentId, m.userId, max(m.id))
			from Message m where m.parentId in :parentIds group by m.parentId, m.userId
			""")
	List<Replier> findRepliers(@Param("parentIds") Collection<Long> parentIds);

	record Replier(long parentId, long userId, long lastReplyId) {
	}

	// 同じ人が同じ clientId で送ったもの（FN-07 5 章の 8）
	Optional<Message> findByUserIdAndClientId(long userId, UUID clientId);

	// その会話の親メッセージか（既読の位置。FN-14 4 章）
	@Query("""
			select count(m) > 0 from Message m
			where m.id = :id and m.conversationId = :conversationId and m.parentId is null
			""")
	boolean isParentInConversation(@Param("id") long id, @Param("conversationId") long conversationId);

	// メッセージのない DM は、作った人のサイドバーにだけ出す（FN-12 5 章の 4）
	boolean existsByConversationId(long conversationId);

	// 会話のいちばん新しいメッセージ（スレッドの返信を含む）の ID。なければ 0。
	// 参加・招待したときの最後に読んだメッセージにする（参加前のメッセージを未読にしない。FN-06 5 章の 2）
	@Query("select coalesce(max(m.id), 0) from Message m where m.conversationId = :conversationId")
	long findLatestId(@Param("conversationId") long conversationId);

	// 編集・削除で使う。返信の追加・削除と同時に起きても件数が食い違わないよう（BR-8）、
	// また「削除されました」にした本文を同時の編集で戻さないよう、行をロックする
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select m from Message m where m.id = :id")
	Optional<Message> findByIdForUpdate(@Param("id") long id);

}
