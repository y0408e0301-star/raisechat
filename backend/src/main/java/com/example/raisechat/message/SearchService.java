package com.example.raisechat.message;

import java.util.List;
import java.util.regex.Pattern;

import org.jspecify.annotations.Nullable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.conversation.Conversation;
import com.example.raisechat.conversation.ConversationAccess;
import com.example.raisechat.conversation.ConversationRepository;
import com.example.raisechat.workspace.WorkspaceAccess;

// メッセージ検索（機能定義書 FN-13、データ設計書 8.3）。そのワークスペースの、自分が見られる会話のメッセージとスレッドの返信から、
// 空白で区切った言葉をすべて含むものを、新しい順に 20 件ずつ返す。大文字・小文字を区別しない部分一致（lower(本文) LIKE）で、
// 本文の GIN の索引（pg_bigm。1〜2 文字の言葉にも効く）を使う。結果はリアルタイムでは変えない（SR-8）
@Service
class SearchService {

	// 1 回に返す件数（SR-1）
	static final int PAGE_SIZE = 20;

	// 検索の文字の長さ（FN-13 4 章）
	static final int QUERY_MAX = 100;

	// 使う言葉の数。11 個目からは使わない（4 章）
	static final int MAX_WORDS = 10;

	// 言葉の区切り（半角・全角の空白）
	private static final Pattern SPACES = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);

	private final NamedParameterJdbcTemplate jdbc;

	private final WorkspaceAccess workspaceAccess;

	private final ConversationAccess conversationAccess;

	private final MessageService messageService;

	SearchService(NamedParameterJdbcTemplate jdbc, WorkspaceAccess workspaceAccess,
			ConversationAccess conversationAccess, MessageService messageService) {
		this.jdbc = jdbc;
		this.workspaceAccess = workspaceAccess;
		this.conversationAccess = conversationAccess;
		this.messageService = messageService;
	}

	// conversationId は見られる、同じワークスペースの会話（でなければ 404）。from は送った人のユーザー ID（いまのメンバーでなくてもよい）
	@Transactional(readOnly = true)
	SearchPage search(long me, long workspaceId, @Nullable String q, @Nullable Long conversationId,
			@Nullable String from, @Nullable String cursor) {
		this.workspaceAccess.requireMember(me, workspaceId);
		List<String> words = words(q);
		long before = MessageService.parseCursor(cursor);
		MapSqlParameterSource params = new MapSqlParameterSource("me", me).addValue("workspaceId", workspaceId)
			.addValue("before", before)
			.addValue("limit", PAGE_SIZE + 1);
		StringBuilder sql = new StringBuilder("""
				SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id
				WHERE c.workspace_id = :workspaceId AND m.deleted_at IS NULL AND m.id < :before
				  AND\s""").append(ConversationRepository.VISIBLE_TO_ME);
		for (int i = 0; i < words.size(); i++) {
			sql.append(" AND lower(m.body) LIKE lower(:w").append(i).append(") ESCAPE '\\'");
			params.addValue("w" + i, "%" + escape(words.get(i)) + "%");
		}
		if (conversationId != null) {
			Conversation conversation = this.conversationAccess.requireVisible(me, conversationId);
			if (conversation.getWorkspaceId() != workspaceId) {
				throw new ApiException(ErrorCode.CONVERSATION_NOT_FOUND);
			}
			sql.append(" AND m.conversation_id = :conversationId");
			params.addValue("conversationId", conversationId);
		}
		if (from != null && !from.isBlank()) {
			sql.append(" AND m.user_id = (SELECT u.id FROM users u WHERE lower(u.username) = lower(:from))");
			params.addValue("from", from.strip());
		}
		sql.append(" ORDER BY m.id DESC LIMIT :limit");
		// 毎回、言葉を見て計画を立てさせる（データ設計書 8.3）。PostgreSQL は同じ SQL を 5 回実行すると、パラメータを見ない
		// 汎用の計画に替えることがある。よくある 1 文字の言葉は、索引で何万行も集めるより新しい順に読んで 21 件で止めるほうが
		// 速く、まれな言葉は索引が速いので、言葉ごとに選ばせる（pg_trgm のときは汎用の計画で約 5 秒かかった）。
		// この取引の中だけの設定（SET LOCAL）なので、このメソッドの @Transactional を外さない（外すと効かない）
		this.jdbc.getJdbcTemplate().execute("SET LOCAL plan_cache_mode = force_custom_plan");
		List<Long> ids = this.jdbc.queryForList(sql.toString(), params, Long.class);
		List<Long> page = ids.subList(0, Math.min(PAGE_SIZE, ids.size()));
		List<SearchResult> items = this.messageService.found(me, page)
			.stream()
			.map((f) -> new SearchResult(f.message(), f.conversation()))
			.toList();
		String next = (ids.size() > PAGE_SIZE) ? String.valueOf(page.getLast()) : null;
		return new SearchPage(items, next);
	}

	// 前後の空白を除いて 1〜100 文字。空白で言葉に分け、10 個まで使う（4 章）
	static List<String> words(@Nullable String raw) {
		String q = (raw == null) ? "" : raw.strip();
		if (q.isEmpty()) {
			throw new ApiException(ErrorCode.QUERY_REQUIRED, "q");
		}
		if (q.codePointCount(0, q.length()) > QUERY_MAX) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "q");
		}
		List<String> all = List.of(SPACES.split(q));
		return all.subList(0, Math.min(MAX_WORDS, all.size()));
	}

	// LIKE で特別な意味を持つ文字（\ と % と _）を、ただの文字にする（5 章の 2）
	static String escape(String word) {
		return word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
	}

	// 検索の結果（FN-13 6 章）
	record SearchPage(List<SearchResult> items, @Nullable String nextCursor) {
	}

	// 結果の 1 行。会話はチャンネルなら名前、DM なら相手
	record SearchResult(MessageView message, MessageService.MessageConversation conversation) {
	}

}
