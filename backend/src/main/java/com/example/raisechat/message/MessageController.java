package com.example.raisechat.message;

import java.util.List;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.example.raisechat.common.CurrentUser;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

// メッセージの API（機能定義書 FN-07 6 章）
@Tag(name = "FN-07 メッセージ")
@RestController
class MessageController {

	private final MessageService messageService;

	MessageController(MessageService messageService) {
		this.messageService = messageService;
	}

	@Operation(summary = "会話のメッセージの一覧",
			description = "親メッセージ（スレッドの返信でないもの）を古い順に返す。before（その ID より前）・after（その ID より後）・"
					+ "around（そのメッセージと前後 25 件ずつ。スレッドの返信ならその親の前後。MS-14）のどれか、またはなし（最新）。"
					+ "limit は 1〜50（指定がなければ 50。around とは一緒に使えない）")
	@GetMapping("/api/conversations/{conversationId}/messages")
	MessageService.MessagePage list(@AuthenticationPrincipal Jwt jwt, @PathVariable long conversationId,
			@RequestParam(required = false) @Nullable Long before, @RequestParam(required = false) @Nullable Long after,
			@RequestParam(required = false) @Nullable Long around,
			@RequestParam(required = false) @Nullable Integer limit) {
		return this.messageService.list(CurrentUser.id(jwt), conversationId, before, after, around, limit);
	}

	@Operation(summary = "自分あてのメンションの一覧（FN-14）",
			description = "そのワークスペースのいま見られる会話のものを、新しい順に 20 件ずつ。cursor は前回の nextCursor")
	@GetMapping("/api/workspaces/{workspaceId}/mentions")
	MessageService.MentionPage mentions(@AuthenticationPrincipal Jwt jwt, @PathVariable long workspaceId,
			@RequestParam(required = false) @Nullable String cursor) {
		return this.messageService.mentions(CurrentUser.id(jwt), workspaceId, cursor);
	}

	@Operation(summary = "1 件のメッセージ", description = "添付の署名付き URL の期限が切れたときに読み直す")
	@GetMapping("/api/messages/{messageId}")
	MessageView get(@AuthenticationPrincipal Jwt jwt, @PathVariable long messageId) {
		return this.messageService.get(CurrentUser.id(jwt), messageId);
	}

	@Operation(summary = "メッセージを送る", description = "同じ clientId で 2 回送ったときは、2 つ目を追加せず 1 つ目を返す。添付があれば本文は空でもよい")
	@ApiResponse(responseCode = "201", description = "送った")
	@PostMapping("/api/conversations/{conversationId}/messages")
	@ResponseStatus(HttpStatus.CREATED)
	MessageView post(@AuthenticationPrincipal Jwt jwt, @PathVariable long conversationId,
			@RequestBody PostMessageRequest request) {
		return this.messageService.post(CurrentUser.id(jwt), conversationId, request.body(), request.clientId(),
				request.attachmentIds());
	}

	@Operation(summary = "スレッドの返信の一覧（FN-08）",
			description = "親メッセージと、返信を古い順に返す。before・after・limit は会話の一覧と同じ。「削除されました」の親のスレッドも読める")
	@GetMapping("/api/messages/{parentId}/replies")
	MessageService.ReplyPage replies(@AuthenticationPrincipal Jwt jwt, @PathVariable long parentId,
			@RequestParam(required = false) @Nullable Long before, @RequestParam(required = false) @Nullable Long after,
			@RequestParam(required = false) @Nullable Integer limit) {
		return this.messageService.replies(CurrentUser.id(jwt), parentId, before, after, limit);
	}

	@Operation(summary = "スレッドに返信する（FN-08）",
			description = "送り方・clientId・添付は会話への送信と同じ。返信への返信は 400 CANNOT_REPLY_TO_REPLY")
	@ApiResponse(responseCode = "201", description = "送った")
	@PostMapping("/api/messages/{parentId}/replies")
	@ResponseStatus(HttpStatus.CREATED)
	MessageView reply(@AuthenticationPrincipal Jwt jwt, @PathVariable long parentId,
			@RequestBody PostMessageRequest request) {
		return this.messageService.postReply(CurrentUser.id(jwt), parentId, request.body(), request.clientId(),
				request.attachmentIds());
	}

	@Operation(summary = "メッセージを編集する",
			description = "送った本人だけ（オーナーでもほかの人のものは 403）。keepAttachmentIds にない添付は外す（足すことはできない）")
	@PatchMapping("/api/messages/{messageId}")
	MessageView edit(@AuthenticationPrincipal Jwt jwt, @PathVariable long messageId,
			@RequestBody EditMessageRequest request) {
		return this.messageService.edit(CurrentUser.id(jwt), messageId, request.body(), request.keepAttachmentIds());
	}

	@Operation(summary = "メッセージを削除する", description = "送った本人とオーナーだけ。返信のある親メッセージは「削除されました」にして 200 で返し、それ以外は消して 204")
	@ApiResponse(responseCode = "200", description = "「削除されました」にした",
			content = @Content(schema = @Schema(implementation = MessageView.class)))
	@ApiResponse(responseCode = "204", description = "消した")
	@DeleteMapping("/api/messages/{messageId}")
	ResponseEntity<MessageView> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable long messageId) {
		return this.messageService.delete(CurrentUser.id(jwt), messageId)
			.map(ResponseEntity::ok)
			.orElseGet(() -> ResponseEntity.noContent().build());
	}

	record PostMessageRequest(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED,
					description = "前後の空白を除き、改行を LF にそろえて 0〜4,000 文字。添付がないときは 1 文字以上（FN-07 4 章）") @Nullable String body,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED,
					description = "画面が送信ごとに作る UUID。同じ送信を 2 回追加しないために使う") @Nullable String clientId,
			@Schema(description = "complete を済ませた添付の uploadId（0〜4 個。並べた順に出す）") @Nullable List<Long> attachmentIds) {
	}

	record EditMessageRequest(@Schema(requiredMode = Schema.RequiredMode.REQUIRED,
			description = "前後の空白を除き、改行を LF にそろえて 0〜4,000 文字。添付が残らないときは 1 文字以上（FN-07 4 章）") @Nullable String body,
			@Schema(description = "残す添付の ID。null ならすべて残す") @Nullable List<Long> keepAttachmentIds) {
	}

}
