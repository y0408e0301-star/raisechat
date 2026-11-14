package com.example.raisechat.profile;

import java.time.Instant;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.emoji.Emojis;

// ステータスの入力の条件（FN-02 4 章）。画面では条件に合わない値を送れないので、合わなければ 400 BAD_REQUEST
final class ProfileInputs {

	static final int STATUS_TEXT_MAX = 100;

	private ProfileInputs() {
	}

	// 絵文字 1 つ（FN-10 4 章と同じ条件）。一覧の形に直して返す。空なら null
	static @Nullable String statusEmoji(@Nullable String raw, Emojis emojis) {
		if (raw == null || raw.isEmpty()) {
			return null;
		}
		String emoji = emojis.normalize(raw);
		if (emoji == null) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "statusEmoji");
		}
		return emoji;
	}

	// 前後の空白を取り除いて 0〜100 文字（コードポイント）、改行なし。空なら null
	static @Nullable String statusText(@Nullable String raw) {
		String text = (raw == null) ? "" : raw.strip();
		if (text.isEmpty()) {
			return null;
		}
		if (text.indexOf('\n') >= 0 || text.indexOf('\r') >= 0
				|| text.codePointCount(0, text.length()) > STATUS_TEXT_MAX) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "statusText");
		}
		return text;
	}

	// 今より後か、null（消さない）
	static @Nullable Instant statusExpiresAt(@Nullable Instant raw, Instant now) {
		if (raw != null && !raw.isAfter(now)) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "statusExpiresAt");
		}
		return raw;
	}

}
