package com.example.raisechat.profile;

import static com.example.raisechat.ApiAssertions.assertApiError;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import com.example.raisechat.TestEntities;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.emoji.Emojis;

// ステータスの入力の条件（FN-02 4 章）
class ProfileInputsTests {

	private static final Emojis EMOJIS = new Emojis();

	@ParameterizedTest
	@NullAndEmptySource
	void 絵文字が空ならなし(String emoji) {
		assertThat(ProfileInputs.statusEmoji(emoji, EMOJIS)).isNull();
	}

	@Test
	void 絵文字は一覧にある1つだけ() {
		assertThat(ProfileInputs.statusEmoji("🏖️", EMOJIS)).isEqualTo("🏖️");
		// 画面の絵文字の一覧が付ける U+FE0F は取る
		assertThat(ProfileInputs.statusEmoji("👍️", EMOJIS)).isEqualTo("👍");
		assertApiError(() -> ProfileInputs.statusEmoji("😀😀", EMOJIS), ErrorCode.BAD_REQUEST, "statusEmoji");
		assertApiError(() -> ProfileInputs.statusEmoji("休", EMOJIS), ErrorCode.BAD_REQUEST, "statusEmoji");
	}

	@ParameterizedTest
	@NullAndEmptySource
	@ValueSource(strings = { " ", "　" })
	void 文が空白だけならなし(String text) {
		assertThat(ProfileInputs.statusText(text)).isNull();
	}

	// TC-02-5
	@Test
	void 文は前後の空白を除いて100文字まで() {
		assertThat(ProfileInputs.statusText("  休暇中  ")).isEqualTo("休暇中");
		// 絵文字（サロゲートペア）も 1 文字に数える
		assertThat(ProfileInputs.statusText("😀".repeat(100))).hasSize(200);
		assertApiError(() -> ProfileInputs.statusText("あ".repeat(101)), ErrorCode.BAD_REQUEST, "statusText");
	}

	@ParameterizedTest
	@ValueSource(strings = { "休暇\n中", "休暇\r中" })
	void 文に改行を入れられない(String text) {
		assertApiError(() -> ProfileInputs.statusText(text), ErrorCode.BAD_REQUEST, "statusText");
	}

	@Test
	void 消す時刻は今より後かなし() {
		assertThat(ProfileInputs.statusExpiresAt(null, TestEntities.NOW)).isNull();
		assertThat(ProfileInputs.statusExpiresAt(TestEntities.NOW.plusSeconds(1), TestEntities.NOW))
			.isEqualTo(TestEntities.NOW.plusSeconds(1));
		assertApiError(() -> ProfileInputs.statusExpiresAt(TestEntities.NOW, TestEntities.NOW), ErrorCode.BAD_REQUEST,
				"statusExpiresAt");
		assertApiError(
				() -> ProfileInputs.statusExpiresAt(TestEntities.NOW.minus(Duration.ofMinutes(1)), TestEntities.NOW),
				ErrorCode.BAD_REQUEST, "statusExpiresAt");
	}

}
