package com.example.raisechat.workspace;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;

// メンバーの一覧の絞り込み（FN-05 4 章）と、並び（オーナーが先頭、表示名の順）のカーソル（機能定義書 3.4）
final class MemberInputs {

	static final int QUERY_MAX = 30;

	private MemberInputs() {
	}

	// 絞り込みの文字（トリム後 0〜30 文字）を、それを含むものに当たる LIKE の形にする。
	// %・_・\ は文字として探すよう逃がす（ESCAPE '\'）。大文字・小文字をそろえるのは SQL の lower() で行う
	static String pattern(@Nullable String rawQuery) {
		String q = (rawQuery == null) ? "" : rawQuery.strip();
		if (q.codePointCount(0, q.length()) > QUERY_MAX) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "q");
		}
		String escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
		return "%" + escaped + "%";
	}

	// カーソル「最後に出した行の順位（オーナー 0・メンバー 1）:ユーザー ID:表示名」。画面は中身を読まない。
	// ユーザー ID には「:」が入らないので、2 つ目の「:」より後ろはすべて表示名
	record Cursor(int rank, String username, String displayName) {

		// オーナー（0）より前から始める
		static final Cursor FIRST = new Cursor(-1, "", "");

		static Cursor parse(@Nullable String raw) {
			if (raw == null || raw.isEmpty()) {
				return FIRST;
			}
			String[] parts = raw.split(":", 3);
			if (parts.length == 3 && (parts[0].equals("0") || parts[0].equals("1"))) {
				return new Cursor(Integer.parseInt(parts[0]), parts[1], parts[2]);
			}
			throw new ApiException(ErrorCode.BAD_REQUEST, "cursor");
		}

		static Cursor after(MemberView last) {
			return new Cursor((last.role() == WorkspaceMember.Role.OWNER) ? 0 : 1, last.username(), last.displayName());
		}

		String format() {
			return this.rank + ":" + this.username + ":" + this.displayName;
		}

	}

}
