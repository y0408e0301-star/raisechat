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
	// 添付（開発計画書 1-11）を作るまでは、本文がないものは送れない
	static String valid(@Nullable String raw) {
		String body = (raw == null) ? "" : raw.replace("\r\n", "\n").replace('\r', '\n').strip();
		if (body.isEmpty()) {
			throw new ApiException(ErrorCode.MESSAGE_EMPTY, "body");
		}
		if (body.codePointCount(0, body.length()) > MAX) {
			throw new ApiException(ErrorCode.MESSAGE_TOO_LONG, "body");
		}
		return body;
	}

}
