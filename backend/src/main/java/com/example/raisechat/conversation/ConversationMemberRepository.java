package com.example.raisechat.conversation;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ConversationMemberRepository extends JpaRepository<ConversationMember, ConversationMember.Key> {

	long countByConversationId(long conversationId);

}
