package com.example.raisechat.conversation;

import java.util.List;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.example.raisechat.common.CurrentUser;
import com.example.raisechat.user.UserSummary;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

// チャンネルの API（機能定義書 FN-06 6 章）
@Tag(name = "FN-06 チャンネル")
@RestController
class ChannelController {

	private final ChannelService channelService;

	ChannelController(ChannelService channelService) {
		this.channelService = channelService;
	}

	@Operation(summary = "チャンネルの一覧（G-8）", description = "公開チャンネルと、自分が入っているプライベートチャンネルを名前の順に 50 件ずつ。q は名前に含む文字（0〜80 文字）")
	@GetMapping("/api/workspaces/{workspaceId}/channels")
	ChannelService.ChannelPage list(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId,
			@RequestParam(required = false) @Nullable String q,
			@RequestParam(required = false) @Nullable String cursor) {
		return this.channelService.list(CurrentUser.id(jwt), workspaceId, q, cursor);
	}

	@Operation(summary = "チャンネルを作る", description = "自分をメンバーにする。同じ名前（大文字・小文字を区別しない）があれば 409")
	@ApiResponse(responseCode = "201", description = "作った")
	@PostMapping("/api/workspaces/{workspaceId}/channels")
	@ResponseStatus(HttpStatus.CREATED)
	ConversationDetail create(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId,
			@RequestBody CreateChannelRequest request) {
		return this.channelService.create(CurrentUser.id(jwt), workspaceId, request.name(), request.description(),
				request.visibility());
	}

	@Operation(summary = "会話のメンバーの一覧", description = "表示名の順に 50 人ずつ。q は表示名かユーザー ID に含む文字")
	@GetMapping("/api/conversations/{conversationId}/members")
	ChannelService.MemberPage members(@AuthenticationPrincipal Jwt jwt, @PathVariable long conversationId,
			@RequestParam(required = false) @Nullable String q,
			@RequestParam(required = false) @Nullable String cursor) {
		return this.channelService.members(CurrentUser.id(jwt), conversationId, q, cursor);
	}

	@Operation(summary = "プライベートチャンネルに招待できる人",
			description = "そのチャンネルにいないワークスペースのメンバーを表示名の順に 50 人まで。q は表示名かユーザー ID に含む文字")
	@GetMapping("/api/conversations/{conversationId}/candidates")
	List<UserSummary> candidates(@AuthenticationPrincipal Jwt jwt, @PathVariable long conversationId,
			@RequestParam(required = false) @Nullable String q) {
		return this.channelService.candidates(CurrentUser.id(jwt), conversationId, q);
	}

	@Operation(summary = "公開チャンネルに参加する", description = "もう入っていれば何もしない。プライベートチャンネル・DM は 403")
	@PostMapping("/api/conversations/{conversationId}/join")
	ConversationDetail join(@AuthenticationPrincipal Jwt jwt, @PathVariable long conversationId) {
		return this.channelService.join(CurrentUser.id(jwt), conversationId);
	}

	@Operation(summary = "チャンネルから退出する", description = "general は 403。入っていなければ何もしない")
	@ApiResponse(responseCode = "204", description = "退出した")
	@PostMapping("/api/conversations/{conversationId}/leave")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void leave(@AuthenticationPrincipal Jwt jwt, @PathVariable long conversationId) {
		this.channelService.leave(CurrentUser.id(jwt), conversationId);
	}

	@Operation(summary = "プライベートチャンネルに招待する", description = "1 人でもワークスペースにいなければ 404 で誰も足さない。もう入っている人は飛ばし、足した人を返す")
	@PostMapping("/api/conversations/{conversationId}/members")
	List<UserSummary> invite(@AuthenticationPrincipal Jwt jwt, @PathVariable long conversationId,
			@RequestBody InviteRequest request) {
		return this.channelService.invite(CurrentUser.id(jwt), conversationId, request.usernames());
	}

	@Operation(summary = "チャンネルを削除する", description = "オーナーだけ、general 以外。メッセージなども一緒に消える")
	@ApiResponse(responseCode = "204", description = "削除した")
	@DeleteMapping("/api/conversations/{conversationId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable long conversationId) {
		this.channelService.delete(CurrentUser.id(jwt), conversationId);
	}

	record CreateChannelRequest(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED,
					description = "前後の空白を除いて 1〜80 文字。空白を含まない") @Nullable String name,
			@Schema(description = "前後の空白を除いて 0〜250 文字。改行を含まない") @Nullable String description,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {
					"PUBLIC", "PRIVATE" }) @Nullable String visibility){
	}

	record InviteRequest(@ArraySchema(minItems = 1, maxItems = 50, schema = @Schema(description = "ユーザー ID")) @Schema(
			requiredMode = Schema.RequiredMode.REQUIRED) @Nullable List<String> usernames) {
	}

}
