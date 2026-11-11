package com.example.raisechat.conversation;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ConversationMemberRepository extends JpaRepository<ConversationMember, ConversationMember.Key> {

	long countByConversationId(long conversationId);

	// 最後に読んだメッセージを進める。古い位置を送られても戻さない（FN-14 5 章の 3、BR-15）。
	// 参加していない公開チャンネルでは行がないので何もしない（未読を出さない。FN-14 5 章の 4）
	@Modifying
	@Query(value = """
			UPDATE conversation_members SET last_read_message_id = GREATEST(last_read_message_id, :messageId)
			WHERE conversation_id = :conversationId AND user_id = :userId
			""", nativeQuery = true)
	int advanceLastRead(@Param("conversationId") long conversationId, @Param("userId") long userId,
			@Param("messageId") long messageId);

}
