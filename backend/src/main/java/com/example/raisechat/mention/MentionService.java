package com.example.raisechat.mention;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.conversation.ConversationAccess;
import com.example.raisechat.user.User;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.user.UserSummaries;
import com.example.raisechat.user.UserSummary;

// メンションの候補（機能定義書 FN-11 MN-1）
@Service
class MentionService {

	// 候補に出す人数
	static final int CANDIDATE_LIMIT = 8;

	// 候補の文字の長さ（FN-11 4 章）
	static final int QUERY_MAX = 30;

	private final MentionRepository mentions;

	private final ConversationAccess access;

	private final UserRepository users;

	private final UserSummaries userSummaries;

	private final Clock clock;

	MentionService(MentionRepository mentions, ConversationAccess access, UserRepository users,
			UserSummaries userSummaries, Clock clock) {
		this.mentions = mentions;
		this.access = access;
		this.users = users;
		this.userSummaries = userSummaries;
		this.clock = clock;
	}

	// その会話を見られる人（自分を除く）のうち、表示名かユーザー ID に q を含む人を、会話のメンバーを先にして 8 人まで。
	// q が空なら絞らない。見られない会話は 404
	@Transactional(readOnly = true)
	List<MentionCandidate> candidates(long me, long conversationId, @Nullable String q) {
		String pattern = pattern(q);
		this.access.requireVisible(me, conversationId);
		List<MentionRepository.CandidateRow> rows = this.mentions.findCandidates(me, conversationId, pattern,
				CANDIDATE_LIMIT);
		Map<Long, User> found = this.users
			.findAllById(rows.stream().map(MentionRepository.CandidateRow::getId).toList())
			.stream()
			.collect(Collectors.toMap(User::getId, Function.identity()));
		Instant now = this.clock.instant();
		return rows.stream()
			.map((row) -> new MentionCandidate(this.userSummaries.of(found.get(row.getId()), now), row.getMember()))
			.toList();
	}

	// LIKE の形（%…%）。ワイルドカードの文字は逃がす
	private static String pattern(@Nullable String rawQuery) {
		String q = (rawQuery == null) ? "" : rawQuery.strip();
		if (q.codePointCount(0, q.length()) > QUERY_MAX) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "q");
		}
		return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
	}

	// 候補の 1 人。member は会話のメンバーか（違えば画面は「チャンネルにいません」を出す。画面設計書 2.16）
	record MentionCandidate(UserSummary user, boolean member) {
	}

}
