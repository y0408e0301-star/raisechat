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

// メンバー管理の API（機能定義書 FN-05 6 章）
@Tag(name = "FN-05 メンバー管理")
@RestController
class MemberController {

	private final MemberService memberService;

	MemberController(MemberService memberService) {
		this.memberService = memberService;
	}

	@Operation(summary = "メンバーの一覧（G-9）",
			description = "オーナーが先頭、表示名の順に 50 人ずつ。q は表示名かユーザー ID に含む文字（0〜30 文字）。memberCount はワークスペースの人数")
	@GetMapping("/api/workspaces/{workspaceId}/members")
	MemberService.WorkspaceMemberPage list(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId,
			@RequestParam(required = false) @Nullable String q,
			@RequestParam(required = false) @Nullable String cursor) {
		return this.memberService.list(CurrentUser.id(jwt), workspaceId, q, cursor);
	}

	@Operation(summary = "1 人のメンバー", description = "ワークスペースにいなければ 404")
	@GetMapping("/api/workspaces/{workspaceId}/members/{username}")
	MemberView get(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId, @PathVariable String username) {
		return this.memberService.get(CurrentUser.id(jwt), workspaceId, username);
	}

	@Operation(summary = "キックする", description = "オーナーだけ。オーナーはキックできない。ワークスペースとそのチャンネルから外す（DM は残す）")
	@ApiResponse(responseCode = "204", description = "キックした")
	@DeleteMapping("/api/workspaces/{workspaceId}/members/{username}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void kick(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId, @PathVariable String username) {
		this.memberService.kick(CurrentUser.id(jwt), workspaceId, username);
	}

	@Operation(summary = "ワークスペースから退出する", description = "オーナーは退出できない。ワークスペースとそのチャンネルから外れる（DM は残す）")
	@ApiResponse(responseCode = "204", description = "退出した")
	@PostMapping("/api/workspaces/{workspaceId}/leave")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void leave(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId) {
		this.memberService.leave(CurrentUser.id(jwt), workspaceId);
	}

}
