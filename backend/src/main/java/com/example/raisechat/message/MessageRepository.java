package com.example.raisechat.message;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

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

	// 同じ人が同じ clientId で送ったもの（FN-07 5 章の 8）
	Optional<Message> findByUserIdAndClientId(long userId, UUID clientId);

	// その会話の親メッセージか（既読の位置。FN-14 4 章）
	@Query("""
			select count(m) > 0 from Message m
			where m.id = :id and m.conversationId = :conversationId and m.parentId is null
			""")
	boolean isParentInConversation(@Param("id") long id, @Param("conversationId") long conversationId);

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
