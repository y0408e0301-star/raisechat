package com.example.raisechat.mention;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

// 本文から「@ユーザー ID」を探す決まり（FN-11 5 章の 1、TC-11-4）
class MentionSyntaxTests {

	@Test
	void 出てきた順に小文字にそろえて同じものは1つ() {
		assertThat(MentionSyntax.usernames("@Hanako と @taro_y、もう一度 @HANAKO")).containsExactly("hanako", "taro_y");
	}

	@ParameterizedTest
	@ValueSource(strings = { "@taro_y", "@TARO_Y さん", "（@taro_y）", "日本語@taro_y", "行の終わり\n@taro_y", "@taro_y。" })
	void メンションになる(String body) {
		assertThat(MentionSyntax.usernames(body)).containsExactly("taro_y");
	}

	@ParameterizedTest
	@ValueSource(strings = { "a@taro_y", "mail_@taro_y", "@ab", "@abcdefghijklmnop", "@たろう", "`@taro_y`",
			"``code ` @taro_y``", "```\n@taro_y\n```", "前\n  ```js\nconst a = '@taro_y'\n  ```\n後" })
	void メンションにならない(String body) {
		assertThat(MentionSyntax.usernames(body)).isEmpty();
	}

	@Test
	void 閉じていないバッククォートは文字のままで中も探す() {
		assertThat(MentionSyntax.usernames("`の後 @taro_y")).containsExactly("taro_y");
		assertThat(MentionSyntax.usernames("```\n閉じていないブロック @taro_y")).isEmpty();
	}

	@Test
	void コードの前後はつながらない() {
		assertThat(MentionSyntax.usernames("`x`@taro_y と `y` @hanako")).containsExactly("taro_y", "hanako");
	}

}
