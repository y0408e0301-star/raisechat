package com.example.raisechat.workspace;

import static com.example.raisechat.ApiAssertions.assertApiError;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;

import org.junit.jupiter.api.Test;

import com.example.raisechat.common.ErrorCode;

// メンバーの一覧の絞り込みとカーソル（FN-05 4 章・6 章）
class MemberInputsTests {

	@Test
	void 絞り込みはトリムして30文字まで_LIKEの特殊文字を逃がす() {
		assertThat(MemberInputs.pattern(null)).isEqualTo("%%");
		assertThat(MemberInputs.pattern(" たろ ")).isEqualTo("%たろ%");
		assertThat(MemberInputs.pattern("a_b%c\\")).isEqualTo("%a\\_b\\%c\\\\%");
		assertThat(MemberInputs.pattern("あ".repeat(30))).isEqualTo("%" + "あ".repeat(30) + "%");
		assertApiError(() -> MemberInputs.pattern("あ".repeat(31)), ErrorCode.BAD_REQUEST, "q");
	}

	@Test
	void 表示名に区切りの文字があってもカーソルを元に戻せる() {
		MemberView last = new MemberView("hanako", "は:な:こ", null, null, null, null, WorkspaceMember.Role.MEMBER,
				Instant.EPOCH);

		MemberInputs.Cursor cursor = MemberInputs.Cursor.parse(MemberInputs.Cursor.after(last).format());

		assertThat(cursor).isEqualTo(new MemberInputs.Cursor(1, "hanako", "は:な:こ"));
	}

	@Test
	void 形が違うカーソルは400() {
		assertThat(MemberInputs.Cursor.parse(null)).isEqualTo(MemberInputs.Cursor.FIRST);
		assertThat(MemberInputs.Cursor.parse("")).isEqualTo(MemberInputs.Cursor.FIRST);
		for (String raw : new String[] { "1:hanako", "2:hanako:x", "a:b:c" }) {
			assertApiError(() -> MemberInputs.Cursor.parse(raw), ErrorCode.BAD_REQUEST, "cursor");
		}
	}

}
