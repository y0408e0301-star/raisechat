package com.example.raisechat.emoji;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

// 使える絵文字（機能定義書 FN-10 4 章。ステータスの絵文字 FN-02 も同じ）
class EmojisTests {

	private static final Emojis EMOJIS = new Emojis();

	// Emoji 17.0 の emoji-test.txt の fully-qualified 3,944 個と component 9 個。画面の絵文字の一覧
	// （emoji-picker-element-data 1.8.0 の ja、肌の色を含む）の 3,953 個と同じ。U+FE0F
	// を除いても重ならない（重なれば起動しない）
	@Test
	void 一覧を読み込む() {
		assertThat(EMOJIS.size()).isEqualTo(3953);
	}

	// 肌の色・ZWJ でつないだもの・国旗・キーキャップ・Emoji 17.0 で増えたもの（🫪 distorted face）・肌の色と髪型の部品
	@ParameterizedTest
	@ValueSource(strings = { "😀", "👍", "👍🏻", "🏖️", "👨‍👩‍👧", "🧑🏽‍💻", "🇯🇵", "1️⃣", "❤️", "❤️‍🔥", "🫪", "🏻",
			"🦰" })
	void 一覧にある絵文字はそのまま使える(String emoji) {
		assertThat(EMOJIS.normalize(emoji)).isEqualTo(emoji);
	}

	// 画面の絵文字の一覧が付ける余分な U+FE0F は取り、足りない U+FE0F は足す
	@ParameterizedTest
	@CsvSource({ "👍️,👍", "❤,❤️", "🏖,🏖️", "❤‍🔥,❤️‍🔥" })
	void 異体字セレクタの有無の違いは一覧の形に直す(String sent, String saved) {
		assertThat(EMOJIS.normalize(sent)).isEqualTo(saved);
	}

	// 2 つ並べたもの、絵文字でない文字、前後の空白
	@ParameterizedTest
	@NullAndEmptySource
	@ValueSource(strings = { "😀😀", "a", "あ", "1", "😀 " })
	void 一覧にないものは使えない(String emoji) {
		assertThat(EMOJIS.normalize(emoji)).isNull();
	}

	@Test
	void 異体字セレクタだけでは使えない() {
		assertThat(EMOJIS.normalize(Character.toString(0xFE0F))).isNull();
	}

}
