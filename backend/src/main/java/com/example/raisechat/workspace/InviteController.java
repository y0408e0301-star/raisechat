package com.example.raisechat.workspace;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.example.raisechat.common.CurrentUser;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

// 招待リンクの API（機能定義書 FN-04 6 章）
@Tag(name = "FN-04 招待")
@RestController
class InviteController {

	private final InviteService inviteService;

	InviteController(InviteService inviteService) {
		this.inviteService = inviteService;
	}

	@Operation(summary = "招待リンクの一覧（G-11）", description = "オーナーだけ。作った新しい順に 50 件ずつ。作ってから 30 日たったものは消える")
	@GetMapping("/api/workspaces/{workspaceId}/invites")
	InviteService.InvitePage list(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId,
			@RequestParam(required = false) @Nullable String cursor) {
		return this.inviteService.list(CurrentUser.id(jwt), workspaceId, cursor);
	}

	@Operation(summary = "招待リンクを作る", description = "オーナーだけ。期限は 7 日後")
	@ApiResponse(responseCode = "201", description = "作った")
	@PostMapping("/api/workspaces/{workspaceId}/invites")
	@ResponseStatus(HttpStatus.CREATED)
	InviteService.InviteView create(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId) {
		return this.inviteService.create(CurrentUser.id(jwt), workspaceId);
	}

	@Operation(summary = "招待リンクを取り消す", description = "オーナーだけ。行は消さずに取り消し済みにする。取り消し済み・期限切れでも 204")
	@ApiResponse(responseCode = "204", description = "取り消した")
	@DeleteMapping("/api/workspaces/{workspaceId}/invites/{inviteId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void revoke(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId, @PathVariable long inviteId) {
		this.inviteService.revoke(CurrentUser.id(jwt), workspaceId, inviteId);
	}

	@Operation(summary = "招待リンクの中身（G-4）", description = "ログインしていなくてもよい。ログインしていなければワークスペースの名前だけを返す。使えないリンクは 410")
	@GetMapping("/api/invites/{token}")
	InviteService.InvitePreview preview(@AuthenticationPrincipal @Nullable Jwt jwt, @PathVariable String token) {
		return this.inviteService.preview((jwt == null) ? null : CurrentUser.id(jwt), token);
	}

	@Operation(summary = "招待リンクから参加する", description = "ワークスペースのメンバーになり general に入る。すでにメンバーなら何もしない。使えないリンクは 410")
	@PostMapping("/api/invites/{token}/accept")
	WorkspaceDetail accept(@AuthenticationPrincipal Jwt jwt, @PathVariable String token) {
		return this.inviteService.accept(CurrentUser.id(jwt), token);
	}

}
