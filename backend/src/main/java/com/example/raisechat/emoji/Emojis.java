package com.example.raisechat.emoji;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

import org.jspecify.annotations.Nullable;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

// 使える絵文字の一覧（機能定義書 FN-10 4 章。ステータスの絵文字 FN-02 も同じ）。
// Unicode の emoji-test.txt（技術スタック定義書 3.1。画面の絵文字の一覧と同じ版）の fully-qualified のものと、
// 画面の一覧に単独でも出る component（肌の色・髪型の部品 9 個）だけを使える。肌の色や ZWJ でつないだものも 1 行ずつ書かれている。
// 画面の絵文字の一覧（emoji-picker-element-data）は「👍️」のように一覧にない異体字セレクタ（U+FE0F）を付けることがあるので、
// U+FE0F の有無だけが違うものは同じ絵文字とみなし、一覧の形に直す
@Component
public final class Emojis {

	static final String RESOURCE = "emoji/emoji-test.txt";

	private static final String FULLY_QUALIFIED = "; fully-qualified";

	private static final String COMPONENT = "; component";

	private static final String VARIATION_SELECTOR = Character.toString(0xFE0F);

	// U+FE0F を取り除いた形 → 一覧の形
	private final Map<String, String> fullyQualified;

	public Emojis() {
		this.fullyQualified = load();
	}

	// 一覧の形に直した絵文字。一覧にない（絵文字 1 つでない）ときは null
	public @Nullable String normalize(@Nullable String emoji) {
		return (emoji == null) ? null : this.fullyQualified.get(emoji.replace(VARIATION_SELECTOR, ""));
	}

	int size() {
		return this.fullyQualified.size();
	}

	// 行の形：「1F44D 1F3FB ; fully-qualified # 👍🏻 E1.0 thumbs up: light skin tone」
	private static Map<String, String> load() {
		Map<String, String> emojis = new HashMap<>();
		try (BufferedReader reader = new BufferedReader(
				new InputStreamReader(new ClassPathResource(RESOURCE).getInputStream(), StandardCharsets.UTF_8))) {
			String line;
			while ((line = reader.readLine()) != null) {
				int separator = line.indexOf(';');
				if (line.startsWith("#") || separator < 0
						|| !(line.startsWith(FULLY_QUALIFIED, separator) || line.startsWith(COMPONENT, separator))) {
					continue;
				}
				StringBuilder emoji = new StringBuilder();
				for (String codePoint : line.substring(0, separator).trim().split(" +")) {
					emoji.appendCodePoint(Integer.parseInt(codePoint, 16));
				}
				String previous = emojis.put(emoji.toString().replace(VARIATION_SELECTOR, ""), emoji.toString());
				if (previous != null) {
					throw new IllegalStateException("U+FE0F を除くと同じになる絵文字があります：" + previous + " " + emoji);
				}
			}
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		return Map.copyOf(emojis);
	}

}
