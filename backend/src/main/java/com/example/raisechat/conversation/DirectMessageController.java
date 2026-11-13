package com.example.raisechat.conversation;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.example.raisechat.common.CurrentUser;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

// DM の API（機能定義書 FN-12 6 章）。DM の一覧・詳細・メッセージは、チャンネルと同じ API を使う
@Tag(name = "FN-12 DM")
@RestController
class DirectMessageController {

	private final DirectMessageService directMessageService;

	DirectMessageController(DirectMessageService directMessageService) {
		this.directMessageService = directMessageService;
	}

	@Operation(summary = "DM を始める", description = "相手との DM を返す。なければ作る（201）。もうあれば 200。自分とは 400、相手がワークスペースにいなければ 404")
	@ApiResponse(responseCode = "201", description = "作った")
	@PostMapping("/api/workspaces/{workspaceId}/dms")
	ResponseEntity<ConversationDetail> start(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId,
			@RequestBody StartDmRequest request) {
		DirectMessageService.Started started = this.directMessageService.start(CurrentUser.id(jwt), workspaceId,
				request.username());
		return ResponseEntity.status(started.created() ? HttpStatus.CREATED : HttpStatus.OK).body(started.detail());
	}

	record StartDmRequest(@Schema(requiredMode = Schema.RequiredMode.REQUIRED,
			description = "相手のユーザー ID（大文字・小文字を区別しない）") @Nullable String username) {
	}

}
