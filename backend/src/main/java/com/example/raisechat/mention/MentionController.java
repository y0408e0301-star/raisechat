package com.example.raisechat.mention;

import java.util.List;

import org.jspecify.annotations.Nullable;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.raisechat.common.CurrentUser;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

// メンションの API（機能定義書 FN-11 6 章）。メンションの記録はメッセージの送信・編集の中で行う
@Tag(name = "FN-11 メンション")
@RestController
class MentionController {

	private final MentionService mentionService;

	MentionController(MentionService mentionService) {
		this.mentionService = mentionService;
	}

	@Operation(summary = "メンションの候補",
			description = "その会話を見られる人（自分を除く）のうち、表示名かユーザー ID に q（0〜30 文字）を含む人を、会話のメンバーを先にして 8 人まで")
	@GetMapping("/api/conversations/{conversationId}/mention-candidates")
	List<MentionService.MentionCandidate> mentionCandidates(@AuthenticationPrincipal Jwt jwt,
			@PathVariable long conversationId, @RequestParam(required = false) @Nullable String q) {
		return this.mentionService.candidates(CurrentUser.id(jwt), conversationId, q);
	}

}
