package com.example.raisechat.workspace;

import java.util.List;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.example.raisechat.common.CurrentUser;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

// ワークスペースの API（機能定義書 FN-03 6 章）。削除はメンバー管理（開発計画書 1-8）で足す
@Tag(name = "FN-03 ワークスペース")
@RestController
@RequestMapping("/api/workspaces")
class WorkspaceController {

	private final WorkspaceService workspaceService;

	WorkspaceController(WorkspaceService workspaceService) {
		this.workspaceService = workspaceService;
	}

	@Operation(summary = "自分が入っているワークスペースの一覧", description = "名前の順（同じ名前は作った順）。ページングしない")
	@GetMapping
	List<WorkspaceSummary> list(@AuthenticationPrincipal Jwt jwt) {
		return this.workspaceService.list(CurrentUser.id(jwt));
	}

	@Operation(summary = "ワークスペースを作る", description = "自分をオーナーにし、公開チャンネル general を作って自分を入れる。1 人 10 個まで（409）")
	@ApiResponse(responseCode = "201", description = "作った")
	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	WorkspaceDetail create(@AuthenticationPrincipal Jwt jwt, @RequestBody CreateWorkspaceRequest request) {
		return this.workspaceService.create(CurrentUser.id(jwt), request.name());
	}

	@Operation(summary = "ワークスペースの詳細", description = "入っていない・存在しないときは 404")
	@GetMapping("/{workspaceId}")
	WorkspaceDetail get(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId) {
		return this.workspaceService.get(CurrentUser.id(jwt), workspaceId);
	}

	record CreateWorkspaceRequest(@Schema(requiredMode = Schema.RequiredMode.REQUIRED,
			description = "前後の空白を除いて 1〜50 文字。改行を含まない（FN-03 4 章）") @Nullable String name) {
	}

}
