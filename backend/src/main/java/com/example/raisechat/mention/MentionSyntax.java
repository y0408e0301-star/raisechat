package com.example.raisechat.mention;

import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// 本文から「@ユーザー ID」を探す（機能定義書 FN-11 5 章の 1）。
// 「@」に続く 3〜15 文字の半角英数字と「_」で、「@」の前は本文の始まりか英数字・「_」以外の文字。
// ユーザー ID の後ろに英数字・「_」が続くもの（16 文字以上）はメンションにしない。
// コード（` で囲んだ所）とコードブロックの中は探さない。コードブロックは、画面の Markdown（CommonMark）がコードとして出すもの：
// ``` か ~~~ の行で囲んだ所（閉じていなければ本文の終わりまで）と、空白 4 つかタブで始まる行（段落の続きを除く）
final class MentionSyntax {

	private static final Pattern MENTION = Pattern.compile("(?<![A-Za-z0-9_])@([A-Za-z0-9_]{3,15})(?![A-Za-z0-9_])");

	// コードブロックの始まりと終わりの行（行頭の空白は 3 つまで。CommonMark と同じ）。group(1) は ` か ~ の並び
	private static final Pattern FENCE = Pattern.compile("^ {0,3}(`{3,}|~{3,})(.*)$");

	// 空白 4 つかタブで始まる行
	private static final Pattern INDENTED = Pattern.compile("^( {4}|\\t)");

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
		String[] lines = body.split("\n", -1);
		// 開いているコードブロックの印（``` など）。開いていなければ null
		String fence = null;
		// 次の行が空白 4 つで始まればコードブロックになるか（本文の始まり・空行・コードの後。段落の続きはならない）
		boolean indentedCodeAllowed = true;
		for (int i = 0; i < lines.length; i++) {
			String line = lines[i];
			Matcher marker = FENCE.matcher(line);
			boolean code;
			if (fence != null) {
				code = true;
				if (marker.matches() && marker.group(1).charAt(0) == fence.charAt(0)
						&& marker.group(1).length() >= fence.length() && marker.group(2).isBlank()) {
					fence = null;
				}
			}
			else if (marker.matches() && !(marker.group(1).charAt(0) == '`' && marker.group(2).contains("`"))) {
				fence = marker.group(1);
				code = true;
			}
			else {
				code = indentedCodeAllowed && !line.isBlank() && INDENTED.matcher(line).find();
			}
			if (code) {
				lines[i] = " ".repeat(line.length());
			}
			indentedCodeAllowed = code || line.isBlank();
		}
		return withoutCodeSpans(String.join("\n", lines));
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
