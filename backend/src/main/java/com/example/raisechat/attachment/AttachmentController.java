package com.example.raisechat.attachment;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
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

// 添付のアップロードの API（機能定義書 FN-09 6 章）。メッセージに付けるのは FN-07 の送信（attachmentIds）
@Tag(name = "FN-09 添付")
@RestController
class AttachmentController {

	private final AttachmentService attachmentService;

	AttachmentController(AttachmentService attachmentService) {
		this.attachmentService = attachmentService;
	}

	@Operation(summary = "アップロードを受け付ける",
			description = "送れる会話のときだけ。返す putUrl に、headers のヘッダーを付けてファイルを PUT する（期限 15 分）。画像は 10MB、動画は 100MB まで")
	@ApiResponse(responseCode = "201", description = "受け付けた")
	@PostMapping("/api/conversations/{conversationId}/uploads")
	@ResponseStatus(HttpStatus.CREATED)
	AttachmentService.UploadTicket create(@AuthenticationPrincipal Jwt jwt, @PathVariable long conversationId,
			@RequestBody CreateUploadRequest request) {
		return this.attachmentService.create(CurrentUser.id(jwt), conversationId, request.fileName(),
				request.contentType(), request.size());
	}

	@Operation(summary = "アップロードを確かめる",
			description = "PUT の後に呼ぶ。大きさと先頭のバイトで形式を確かめ、画像なら幅・高さと縮小した画像を作る。形式が違えばファイルを消して 400")
	@PostMapping("/api/uploads/{uploadId}/complete")
	AttachmentView complete(@AuthenticationPrincipal Jwt jwt, @PathVariable long uploadId) {
		return this.attachmentService.complete(CurrentUser.id(jwt), uploadId);
	}

	@Operation(summary = "送る前に外す", description = "自分の、まだ送っていないものだけ。S3 のファイルも消す")
	@ApiResponse(responseCode = "204", description = "外した")
	@DeleteMapping("/api/uploads/{uploadId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable long uploadId) {
		this.attachmentService.cancel(CurrentUser.id(jwt), uploadId);
	}

	record CreateUploadRequest(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED,
					description = "1〜255 文字。表示とダウンロードの名前にだけ使う") @Nullable String fileName,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED,
					description = "image/jpeg・image/png・image/gif・image/webp・video/mp4・video/webm") @Nullable String contentType,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "バイト数") @Nullable Long size) {
	}

}
