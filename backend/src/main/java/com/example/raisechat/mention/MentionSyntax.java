package com.example.raisechat.mention;

import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// 本文から「@ユーザー ID」を探す（機能定義書 FN-11 5 章の 1）。
// 「@」に続く 3〜15 文字の半角英数字と「_」で、「@」の前は本文の始まりか英数字・「_」以外の文字。
// ユーザー ID の後ろに英数字・「_」が続くもの（16 文字以上）はメンションにしない。
// コード（` で囲んだ所）とコードブロック（``` の行で囲んだ所）の中は探さない
final class MentionSyntax {

	private static final Pattern MENTION = Pattern.compile("(?<![A-Za-z0-9_])@([A-Za-z0-9_]{3,15})(?![A-Za-z0-9_])");

	// コードブロックの始まりと終わりの行（行頭の空白は 3 つまで。CommonMark と同じ）
	private static final Pattern FENCE = Pattern.compile("^ {0,3}```.*$");

	private MentionSyntax() {
	}

	// 本文に出てきた順のユーザー ID（小文字にそろえ、同じものは 1 つ）
	static Set<String> usernames(String body) {
		Set<String> found = new LinkedHashSet<>();
		Matcher matcher = MENTION.matcher(withoutCode(body));
		while (matcher.find()) {
			found.add(matcher.group(1).toLowerCase(Locale.ROOT));
		}
		return found;
	}

	// コードとコードブロックの中を空白に置き換える（前後の文字がつながってメンションにならないよう、消さずに空白にする）
	static String withoutCode(String body) {
		StringBuilder out = new StringBuilder();
		boolean inBlock = false;
		for (String line : body.split("\n", -1)) {
			if (!out.isEmpty()) {
				out.append('\n');
			}
			if (FENCE.matcher(line).matches()) {
				inBlock = !inBlock;
				out.append(" ".repeat(line.length()));
			}
			else if (inBlock) {
				out.append(" ".repeat(line.length()));
			}
			else {
				out.append(line);
			}
		}
		return withoutCodeSpans(out.toString());
	}

	// ` の並び（同じ数の ` で閉じたもの）の中を空白にする。閉じていない ` は文字のまま
	private static String withoutCodeSpans(String text) {
		StringBuilder out = new StringBuilder(text);
		int i = 0;
		while (i < text.length()) {
			if (text.charAt(i) != '`') {
				i++;
				continue;
			}
			int run = runLength(text, i);
			int close = findRun(text, i + run, run);
			if (close < 0) {
				i += run;
				continue;
			}
			for (int j = i; j < close + run; j++) {
				if (out.charAt(j) != '\n') {
					out.setCharAt(j, ' ');
				}
			}
			i = close + run;
		}
		return out.toString();
	}

	private static int runLength(String text, int from) {
		int end = from;
		while (end < text.length() && text.charAt(end) == '`') {
			end++;
		}
		return end - from;
	}

	// from から後ろで、ちょうど length 個の ` の並び。なければ -1
	private static int findRun(String text, int from, int length) {
		int i = from;
		while (i < text.length()) {
			if (text.charAt(i) != '`') {
				i++;
				continue;
			}
			int run = runLength(text, i);
			if (run == length) {
				return i;
			}
			i += run;
		}
		return -1;
	}

}
