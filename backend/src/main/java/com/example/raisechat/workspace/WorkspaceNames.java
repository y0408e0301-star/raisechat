package com.example.raisechat.workspace;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;

// ワークスペースの名前の条件（FN-03 4 章）
final class WorkspaceNames {

	static final int MAX = 50;

	private WorkspaceNames() {
	}

	// 前後の空白を取り除いて 1〜50 文字（コードポイント）。改行を含まない
	static String valid(@Nullable String raw) {
		String name = (raw == null) ? "" : raw.strip();
		if (name.isEmpty()) {
			throw new ApiException(ErrorCode.WORKSPACE_NAME_REQUIRED, "name");
		}
		// 画面では 51 文字目を入力できず、1 行の入力欄なので改行も入らない。どちらも画面を通さずに送られたときだけ
		if (name.codePointCount(0, name.length()) > MAX || name.indexOf('\n') >= 0 || name.indexOf('\r') >= 0) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "name");
		}
		return name;
	}

}
