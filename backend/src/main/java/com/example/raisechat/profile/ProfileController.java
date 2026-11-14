package com.example.raisechat.profile;

import java.io.IOException;
import java.time.Instant;

import org.jspecify.annotations.Nullable;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.example.raisechat.common.CurrentUser;
import com.example.raisechat.user.UserSummary;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;

// プロフィールの API（機能定義書 FN-02 6 章）。G-16 の 1 人のメンバーは FN-05 の MemberController
@Tag(name = "FN-02 プロフィール")
@RestController
class ProfileController {

	private final ProfileService profileService;

	ProfileController(ProfileService profileService) {
		this.profileService = profileService;
	}

	@Operation(summary = "自分のプロフィール（G-10）", description = "消す時刻を過ぎたステータスは null")
	@GetMapping("/api/me/profile")
	MyProfile get(@AuthenticationPrincipal Jwt jwt) {
		return this.profileService.get(CurrentUser.id(jwt));
	}

	@Operation(summary = "表示名とステータスを変える", description = "4 つとも毎回送る。絵文字も文も空なら、消す時刻もなくす")
	@PatchMapping("/api/me/profile")
	UserSummary update(@AuthenticationPrincipal Jwt jwt, @RequestBody UpdateProfileRequest request) {
		return this.profileService.update(CurrentUser.id(jwt), request.displayName(), request.statusEmoji(),
				request.statusText(), request.statusExpiresAt());
	}

	@Operation(summary = "アバターを替える", description = "JPEG・PNG・WebP の 5MB までの画像。真ん中を正方形に切り取り 256×256px にする。前のアバターは消す")
	@PutMapping(path = "/api/me/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	UserSummary changeAvatar(@AuthenticationPrincipal Jwt jwt, @RequestParam("file") MultipartFile file)
			throws IOException {
		return this.profileService.changeAvatar(CurrentUser.id(jwt), file.getBytes());
	}

	@Operation(summary = "アバターを外す", description = "表示名の頭文字の丸になる。アバターがなければ何もしない")
	@DeleteMapping("/api/me/avatar")
	UserSummary removeAvatar(@AuthenticationPrincipal Jwt jwt) {
		return this.profileService.removeAvatar(CurrentUser.id(jwt));
	}

	record UpdateProfileRequest(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED,
					description = "前後の空白を除いて 1〜30 文字") @Nullable String displayName,
			@Schema(description = "絵文字 1 つ。空か null でなし") @Nullable String statusEmoji,
			@Schema(description = "前後の空白を除いて 0〜100 文字。改行を含まない") @Nullable String statusText,
			@Schema(description = "ステータスを消す日時。今より後か、null（消さない）") @Nullable Instant statusExpiresAt) {
	}

}
