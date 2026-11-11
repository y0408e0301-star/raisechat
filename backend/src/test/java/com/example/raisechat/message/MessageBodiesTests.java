package com.example.raisechat.message;

import static com.example.raisechat.ApiAssertions.assertApiError;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import com.example.raisechat.common.ErrorCode;

// メッセージの本文の条件（FN-07 4 章、TC-07-1）
class MessageBodiesTests {

	@ParameterizedTest
	@NullAndEmptySource
	@ValueSource(strings = { " ", "\n\r\n", "　\t" })
	void 空白と改行だけなら送れない(String body) {
		assertApiError(() -> MessageBodies.valid(body), ErrorCode.MESSAGE_EMPTY, "body");
	}

	@Test
	void 改行をLFにそろえて前後の空白を取り除く() {
		assertThat(MessageBodies.valid("  1行目\r\n2行目\r3行目\n ")).isEqualTo("1行目\n2行目\n3行目");
	}

	@Test
	void 一文字から四千文字まで_絵文字も一文字と数える() {
		assertThat(MessageBodies.valid("a")).isEqualTo("a");
		assertThat(MessageBodies.valid("😀".repeat(4000))).hasSize(8000);
		assertApiError(() -> MessageBodies.valid("😀".repeat(4001)), ErrorCode.MESSAGE_TOO_LONG, "body");
	}

	@Test
	void CRLFはLFにしてから数える() {
		// CRLF のままだと 4,001 文字だが、LF にそろえると 4,000 文字
		assertThat(MessageBodies.valid("a".repeat(3998) + "\r\nb")).hasSize(4000);
	}

}
