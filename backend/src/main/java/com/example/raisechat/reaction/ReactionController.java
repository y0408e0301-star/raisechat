package com.example.raisechat.reaction;

import java.util.List;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.raisechat.common.CurrentUser;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

// リアクションの API（機能定義書 FN-10 6 章）。絵文字は URL エンコードして URL に入れる
@Tag(name = "FN-10 リアクション")
@RestController
class ReactionController {

	private final ReactionService reactionService;

	ReactionController(ReactionService reactionService) {
		this.reactionService = reactionService;
	}

	@Operation(summary = "リアクションを付ける",
			description = "もう付けていれば何もしない。絵文字は Unicode の絵文字 1 つ（FN-10 4 章）。まだ付いていない絵文字で 50 種類を超えるときは 409 REACTION_LIMIT")
	@PutMapping("/api/messages/{messageId}/reactions/{emoji}")
	ReactionsResponse addReaction(@AuthenticationPrincipal Jwt jwt, @PathVariable long messageId,
			@PathVariable String emoji) {
		return new ReactionsResponse(this.reactionService.add(CurrentUser.id(jwt), messageId, emoji));
	}

	@Operation(summary = "自分のリアクションを外す", description = "付けていなければ何もしない")
	@DeleteMapping("/api/messages/{messageId}/reactions/{emoji}")
	ReactionsResponse removeReaction(@AuthenticationPrincipal Jwt jwt, @PathVariable long messageId,
			@PathVariable String emoji) {
		return new ReactionsResponse(this.reactionService.remove(CurrentUser.id(jwt), messageId, emoji));
	}

	// そのメッセージのリアクション全体（MessageView の reactions と同じ形）
	record ReactionsResponse(List<ReactionView> reactions) {
	}

}
