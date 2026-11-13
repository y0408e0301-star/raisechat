package com.example.raisechat.conversation;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
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

	// G-8 のチャンネルの一覧（CH-3）：ワークスペースの公開チャンネルと、自分が入っているプライベートチャンネル（8.1 の条件）。
	// 名前の順（大文字・小文字を区別しない）。:pattern は LIKE の形（%…%。ワイルドカードは ChannelInputs で逃がす）。
	// 続きは (lower(name), id) が :afterName・:afterId より後ろのもの（最初は ''・0）
	@Query(value = """
			SELECT c.id AS "id", c.name AS "name", c.description AS "description", c.visibility AS "visibility",
			       (SELECT count(*) FROM conversation_members m WHERE m.conversation_id = c.id) AS "memberCount",
			       EXISTS (SELECT 1 FROM conversation_members m
			               WHERE m.conversation_id = c.id AND m.user_id = :me) AS "joined"
			FROM conversations c
			WHERE c.workspace_id = :workspaceId AND c.type = 'CHANNEL'
			  AND lower(c.name) LIKE lower(:pattern) ESCAPE '\\'
			  AND (lower(c.name), c.id) > (lower(:afterName), :afterId)
			  AND\s""" + VISIBLE_TO_ME + """
			ORDER BY lower(c.name), c.id
			LIMIT :limit
			""", nativeQuery = true)
	List<ChannelRow> findChannels(@Param("me") long me, @Param("workspaceId") long workspaceId,
			@Param("pattern") String pattern, @Param("afterName") String afterName, @Param("afterId") long afterId,
			@Param("limit") int limit);

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

	// ワークスペースのすべての会話の ID。キック・退出・削除で、その人の購読を取り消すのに使う（機能定義書 4.5）
	@Query("select c.id from Conversation c where c.workspaceId = :workspaceId")
	List<Long> findIdsByWorkspaceId(@Param("workspaceId") long workspaceId);

	// サイドバーの DM（DM-1）：作った人か、メッセージのあるもの（5 章の 4）。
	// 最後の親メッセージの日時の新しい順、メッセージがなければ作った日時（5 章の 5）
	@Query(value = """
			SELECT c.* FROM conversations c
			JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = :me
			WHERE c.workspace_id = :workspaceId AND c.type = 'DM'
			  AND (c.created_by = :me OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id))
			ORDER BY COALESCE((SELECT max(m.created_at) FROM messages m
			                   WHERE m.conversation_id = c.id AND m.parent_id IS NULL), c.created_at) DESC, c.id DESC
			""", nativeQuery = true)
	List<Conversation> findSidebarDms(@Param("me") long me, @Param("workspaceId") long workspaceId);

	// 同じ 2 人の DM（5 章の 1）
	@Query("""
			select c from Conversation c
			where c.workspaceId = :workspaceId and c.type = com.example.raisechat.conversation.Conversation.Type.DM
			  and c.dmUserLow = :low and c.dmUserHigh = :high
			""")
	Optional<Conversation> findDm(@Param("workspaceId") long workspaceId, @Param("low") long low,
			@Param("high") long high);

	// DM を作る。同じ 2 人の DM が同時に作られても 1 つにする（一意の索引 conversations_dm_key）。作ったら 1 を返す
	@Modifying
	@Query(value = """
			INSERT INTO conversations (workspace_id, type, dm_user_low, dm_user_high, created_by, created_at)
			VALUES (:workspaceId, 'DM', :low, :high, :createdBy, :now)
			ON CONFLICT (workspace_id, dm_user_low, dm_user_high) WHERE type = 'DM' DO NOTHING
			""", nativeQuery = true)
	int insertDmIfAbsent(@Param("workspaceId") long workspaceId, @Param("low") long low, @Param("high") long high,
			@Param("createdBy") long createdBy, @Param("now") Instant now);

	// 自分が入っている DM。キック・退出しても行は残るので、招待リンクでまた参加したときに戻す（BR-6、FN-05 MB-7）
	@Query("""
			select c from Conversation c join ConversationMember cm on cm.conversationId = c.id
			where c.workspaceId = :workspaceId and cm.userId = :me
			  and c.type = com.example.raisechat.conversation.Conversation.Type.DM
			order by c.id
			""")
	List<Conversation> findJoinedDms(@Param("me") long me, @Param("workspaceId") long workspaceId);

}
