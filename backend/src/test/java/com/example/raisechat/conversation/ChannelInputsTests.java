package com.example.raisechat.conversation;

import static com.example.raisechat.ApiAssertions.assertApiError;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import com.example.raisechat.common.ErrorCode;

// チャンネルの入力の条件（FN-06 4 章）とカーソル
class ChannelInputsTests {

	@Test
	void 名前は前後の空白を除いて1文字から80文字で_空白を含まない() {
		assertThat(ChannelInputs.name("  旅行の計画 ")).isEqualTo("旅行の計画");
		assertThat(ChannelInputs.name("😀".repeat(80))).hasSize(160);
		assertApiError(() -> ChannelInputs.name("😀".repeat(81)), ErrorCode.BAD_REQUEST, "name");
		assertApiError(() -> ChannelInputs.name(null), ErrorCode.CHANNEL_NAME_INVALID, "name");
		assertApiError(() -> ChannelInputs.name("a b"), ErrorCode.CHANNEL_NAME_INVALID, "name");
		assertApiError(() -> ChannelInputs.name("a　b"), ErrorCode.CHANNEL_NAME_INVALID, "name");
		assertApiError(() -> ChannelInputs.name("a\tb"), ErrorCode.CHANNEL_NAME_INVALID, "name");
	}

	@Test
	void 説明は空ならなしで_250文字まで_改行を含まない() {
		assertThat(ChannelInputs.description("  ")).isNull();
		assertThat(ChannelInputs.description(" 夏の相談 ")).isEqualTo("夏の相談");
		assertThat(ChannelInputs.description("あ".repeat(250))).hasSize(250);
		assertApiError(() -> ChannelInputs.description("あ".repeat(251)), ErrorCode.BAD_REQUEST, "description");
		assertApiError(() -> ChannelInputs.description("一\n二"), ErrorCode.BAD_REQUEST, "description");
	}

	@Test
	void 種類はPUBLICかPRIVATE() {
		assertThat(ChannelInputs.visibility("PRIVATE")).isEqualTo(Conversation.Visibility.PRIVATE);
		assertApiError(() -> ChannelInputs.visibility("public"), ErrorCode.BAD_REQUEST, "visibility");
		assertApiError(() -> ChannelInputs.visibility(null), ErrorCode.BAD_REQUEST, "visibility");
	}

	@Test
	void 絞り込みの文字は小文字のLIKEの形にし_ワイルドカードを逃がす() {
		assertThat(ChannelInputs.pattern(null)).isEqualTo("%%");
		assertThat(ChannelInputs.pattern(" Travel ")).isEqualTo("%travel%");
		assertThat(ChannelInputs.pattern("100%_\\")).isEqualTo("%100\\%\\_\\\\%");
		assertApiError(() -> ChannelInputs.pattern("a".repeat(81)), ErrorCode.BAD_REQUEST, "q");
	}

	@Test
	void カーソルはIDと名前で_名前にコロンがあってもよい() {
		ChannelInputs.Cursor cursor = ChannelInputs.Cursor.parse("12:a:b");
		assertThat(cursor).isEqualTo(new ChannelInputs.Cursor(12, "a:b"));
		assertThat(ChannelInputs.Cursor.parse(cursor.format())).isEqualTo(cursor);
		assertThat(ChannelInputs.Cursor.parse(null)).isEqualTo(ChannelInputs.Cursor.FIRST);
		assertApiError(() -> ChannelInputs.Cursor.parse("abc"), ErrorCode.BAD_REQUEST, "cursor");
		assertApiError(() -> ChannelInputs.Cursor.parse("x:abc"), ErrorCode.BAD_REQUEST, "cursor");
	}

}
