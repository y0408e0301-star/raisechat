package com.example.raisechat.message;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;

// メッセージの本文の条件（FN-07 4 章）
final class MessageBodies {

	static final int MAX = 4000;

	private MessageBodies() {
	}

	// 改行を LF にそろえ、前後の空白を取り除いてから、0〜4,000 文字（コードポイント）か確かめる（BR-1）。
	// 添付がないときは 1 文字以上
	static String valid(@Nullable String raw) {
		return valid(raw, false);
	}

	// allowEmpty：添付があるので、本文は空でもよい
	static String valid(@Nullable String raw, boolean allowEmpty) {
		String body = (raw == null) ? "" : raw.replace("\r\n", "\n").replace('\r', '\n').strip();
		if (body.isEmpty() && !allowEmpty) {
			throw new ApiException(ErrorCode.MESSAGE_EMPTY, "body");
		}
		if (body.codePointCount(0, body.length()) > MAX) {
			throw new ApiException(ErrorCode.MESSAGE_TOO_LONG, "body");
		}
		return body;
	}

}
