package com.example.raisechat.conversation;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ConversationRepository extends JpaRepository<Conversation, Long> {

	// 見られる会話の決まり（データ設計書 8.1、BR-2）。:me が見られる会話 c の条件。
	// メッセージの一覧・購読・検索・メンション・未読でも、この条件を使う（データ設計書 方針 8）
	String VISIBLE_TO_ME = """
			EXISTS (SELECT 1 FROM workspace_members wm
			        WHERE wm.workspace_id = c.workspace_id AND wm.user_id = :me)
			AND (
			      (c.type = 'CHANNEL' AND c.visibility = 'PUBLIC')
			   OR (c.type = 'CHANNEL' AND c.visibility = 'PRIVATE'
			       AND EXISTS (SELECT 1 FROM conversation_members cm
			                   WHERE cm.conversation_id = c.id AND cm.user_id = :me))
			   OR (c.type = 'DM' AND :me IN (c.dm_user_low, c.dm_user_high))
			)
			""";

	@Query(value = "SELECT c.* FROM conversations c WHERE c.id = :id AND " + VISIBLE_TO_ME, nativeQuery = true)
	Optional<Conversation> findVisible(@Param("me") long me, @Param("id") long id);

	@Query("select c from Conversation c where c.workspaceId = :workspaceId and c.general")
	Optional<Conversation> findGeneral(@Param("workspaceId") long workspaceId);

	// サイドバーのチャンネル：自分が入っているチャンネルを、general を先頭に、あとは名前の順に（画面設計書 2.8）。
	// DM は DM（1-9）で足す
	@Query("""
			select c from Conversation c join ConversationMember cm on cm.conversationId = c.id
			where c.workspaceId = :workspaceId and cm.userId = :me
			  and c.type = com.example.raisechat.conversation.Conversation.Type.CHANNEL
			order by c.general desc, lower(c.name), c.id
			""")
	List<Conversation> findJoinedChannels(@Param("me") long me, @Param("workspaceId") long workspaceId);

}
