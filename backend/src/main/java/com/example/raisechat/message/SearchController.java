package com.example.raisechat.message;

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

// メッセージ検索の API（機能定義書 FN-13 6 章）
@Tag(name = "FN-13 検索")
@RestController
class SearchController {

	private final SearchService searchService;

	SearchController(SearchService searchService) {
		this.searchService = searchService;
	}

	@Operation(summary = "メッセージを探す",
			description = "そのワークスペースの、自分が見られる会話のメッセージとスレッドの返信から、q を空白で区切った言葉をすべて含むものを"
					+ "新しい順に 20 件ずつ（大文字・小文字を区別しない部分一致）。conversationId（会話）と from（送った人のユーザー ID）で絞り込める。"
					+ "cursor は前回の nextCursor")
	@GetMapping("/api/workspaces/{workspaceId}/search")
	SearchService.SearchPage search(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId,
			@RequestParam(required = false) @Nullable String q,
			@RequestParam(required = false) @Nullable Long conversationId,
			@RequestParam(required = false) @Nullable String from,
			@RequestParam(required = false) @Nullable String cursor) {
		return this.searchService.search(CurrentUser.id(jwt), workspaceId, q, conversationId, from, cursor);
	}

}
