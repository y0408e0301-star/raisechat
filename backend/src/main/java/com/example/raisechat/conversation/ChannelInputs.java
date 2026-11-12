package com.example.raisechat.conversation;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;

// チャンネルの入力の条件（FN-06 4 章）と、名前の順の一覧のカーソル（機能定義書 3.4）
final class ChannelInputs {

	static final int NAME_MAX = 80;

	static final int DESCRIPTION_MAX = 250;

	static final int QUERY_MAX = 80;

	private ChannelInputs() {
	}

	// 前後の空白を取り除いて 1〜80 文字（コードポイント）。空白（半角・全角）・タブ・改行を含まない
	static String name(@Nullable String raw) {
		String name = (raw == null) ? "" : raw.strip();
		if (name.isEmpty() || name.codePoints().anyMatch(Character::isWhitespace)) {
			throw new ApiException(ErrorCode.CHANNEL_NAME_INVALID, "name");
		}
		// 画面では 81 文字目を入力できない。画面を通さずに送られたときだけ
		if (name.codePointCount(0, name.length()) > NAME_MAX) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "name");
		}
		return name;
	}

	// 前後の空白を取り除いて 0〜250 文字。改行を含まない。空ならなし
	static @Nullable String description(@Nullable String raw) {
		String description = (raw == null) ? "" : raw.strip();
		if (description.codePointCount(0, description.length()) > DESCRIPTION_MAX || description.indexOf('\n') >= 0
				|| description.indexOf('\r') >= 0) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "description");
		}
		return description.isEmpty() ? null : description;
	}

	static Conversation.Visibility visibility(@Nullable String raw) {
		try {
			if (raw != null) {
				return Conversation.Visibility.valueOf(raw);
			}
		}
		catch (IllegalArgumentException ex) {
			// 下で 400 にする
		}
		throw new ApiException(ErrorCode.BAD_REQUEST, "visibility");
	}

	// 絞り込みの文字（トリム後 0〜80 文字）を、それを含むものに当たる LIKE の形にする。
	// %・_・\ は文字として探すよう逃がす（ESCAPE '\'）。大文字・小文字をそろえるのは SQL の lower() で行う
	// （Java と PostgreSQL で小文字にする決まりが違う文字があるため、片方だけで行う）
	static String pattern(@Nullable String rawQuery) {
		String q = (rawQuery == null) ? "" : rawQuery.strip();
		if (q.codePointCount(0, q.length()) > QUERY_MAX) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "q");
		}
		String escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
		return "%" + escaped + "%";
	}

	// 名前の順の一覧のカーソル「最後に出した行の ID:名前」（機能定義書 3.4。画面は中身を読まない）
	record Cursor(long id, String name) {

		static final Cursor FIRST = new Cursor(0, "");

		static Cursor parse(@Nullable String raw) {
			if (raw == null || raw.isEmpty()) {
				return FIRST;
			}
			int colon = raw.indexOf(':');
			try {
				if (colon > 0) {
					return new Cursor(Long.parseLong(raw.substring(0, colon)), raw.substring(colon + 1));
				}
			}
			catch (NumberFormatException ex) {
				// 下で 400 にする
			}
			throw new ApiException(ErrorCode.BAD_REQUEST, "cursor");
		}

		String format() {
			return this.id + ":" + this.name;
		}

	}

}
