package com.example.raisechat.conversation;

import java.util.List;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.example.raisechat.common.CurrentUser;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

// 会話の API のうち、G-5 の枠で使うもの（機能定義書 FN-06 6 章・FN-14 6 章）
@Tag(name = "FN-06 チャンネル")
@RestController
class ConversationController {

	private final ConversationService conversationService;

	ConversationController(ConversationService conversationService) {
		this.conversationService = conversationService;
	}

	@Operation(summary = "サイドバーの会話の一覧", description = "自分が入っているチャンネル（general が先頭、あとは名前の順）。ページングしない")
	@GetMapping("/api/workspaces/{workspaceId}/conversations")
	List<ConversationSummary> list(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId) {
		return this.conversationService.listForSidebar(CurrentUser.id(jwt), workspaceId);
	}

	@Operation(summary = "会話の詳細", description = "見られないとき（入っていないワークスペース・プライベートチャンネルなど）は 404")
	@GetMapping("/api/conversations/{conversationId}")
	ConversationDetail get(@AuthenticationPrincipal Jwt jwt, @PathVariable long conversationId) {
		return this.conversationService.get(CurrentUser.id(jwt), conversationId);
	}

	@Operation(summary = "会話を開いた・読んだ（FN-14）", description = "最後に開いた会話として記録する。最後に読んだメッセージを進めるのはメッセージ（1-4）から")
	@ApiResponse(responseCode = "204", description = "記録した")
	@PostMapping("/api/conversations/{conversationId}/read")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void read(@AuthenticationPrincipal Jwt jwt, @PathVariable long conversationId, @RequestBody ReadRequest request) {
		this.conversationService.read(CurrentUser.id(jwt), conversationId, request.lastMessageId());
	}

	record ReadRequest(@Schema(requiredMode = Schema.RequiredMode.REQUIRED,
			description = "画面に出したいちばん新しいメッセージの ID（なければ 0）") @Nullable Long lastMessageId) {
	}

}
