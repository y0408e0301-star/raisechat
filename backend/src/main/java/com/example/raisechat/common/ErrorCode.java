package com.example.raisechat.common;

import org.springframework.http.HttpStatus;

// API が返すエラーの code と、画面にそのまま出すメッセージ（機能定義書 3.3・4 章）。
// 機能を作るたびに、その機能定義書 9 章の code を足す
public enum ErrorCode {

	// ユーザー登録・ログイン（FN-01 9 章。M-1〜M-8）
	USERNAME_INVALID(HttpStatus.BAD_REQUEST, "ユーザー ID は 3〜15 文字の半角英数字と「_」で入力してください。"),

	USERNAME_TAKEN(HttpStatus.CONFLICT, "このユーザー ID は使われています。"),

	PASSWORD_INVALID(HttpStatus.BAD_REQUEST, "パスワードは英字と数字を含む 8〜64 文字の半角文字で入力してください。"),

	DISPLAY_NAME_REQUIRED(HttpStatus.BAD_REQUEST, "表示名を入力してください。"),

	LOGIN_FAILED(HttpStatus.UNAUTHORIZED, "ユーザー ID かパスワードが違います。"),

	LOGIN_LOCKED(HttpStatus.LOCKED, "ログインに続けて失敗したため、15 分間ログインできません。"),

	UNAUTHENTICATED(HttpStatus.UNAUTHORIZED, "ログインの有効期限が切れました。もう一度ログインしてください。"),

	// 画面には出さない（画面が POST /api/auth/refresh で取り直して、やり直す）
	TOKEN_EXPIRED(HttpStatus.UNAUTHORIZED, "ログインの有効期限が切れました。もう一度ログインしてください。"),

	REFRESH_FAILED(HttpStatus.UNAUTHORIZED, "ログインの有効期限が切れました。もう一度ログインしてください。"),

	// プロフィール（FN-02 9 章。M-9）
	AVATAR_INVALID(HttpStatus.BAD_REQUEST, "アバターに使えるのは 5MB までの JPEG・PNG・WebP の画像です。"),

	AVATAR_TOO_LARGE(HttpStatus.CONTENT_TOO_LARGE, "アバターに使えるのは 5MB までの JPEG・PNG・WebP の画像です。"),

	// ワークスペース（FN-03 9 章。M-11〜M-13）
	WORKSPACE_NAME_REQUIRED(HttpStatus.BAD_REQUEST, "ワークスペースの名前を入力してください。"),

	WORKSPACE_LIMIT(HttpStatus.CONFLICT, "作れるワークスペースは 10 個までです。"),

	WORKSPACE_NOT_FOUND(HttpStatus.NOT_FOUND, "このワークスペースは見つからないか、参加していません。"),

	// 招待リンク（FN-04 9 章。M-18・M-49）。期限切れ・取り消し済み・存在しない・形が違うリンクを見分けない
	INVITE_INVALID(HttpStatus.GONE, "この招待リンクは期限切れか、取り消されています。招待した人に新しいリンクをもらってください。"),

	// 取り消そうとした招待リンクがない
	INVITE_NOT_FOUND(HttpStatus.NOT_FOUND, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	// ワークスペースの削除で、確認の名前が違う（画面では同じになるまで押せないので、画面には出さない）
	CONFIRM_NAME_MISMATCH(HttpStatus.BAD_REQUEST, "ワークスペースの名前が違います。"),

	// メンバー管理（FN-05 9 章。M-49）
	CANNOT_KICK_OWNER(HttpStatus.FORBIDDEN, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	OWNER_CANNOT_LEAVE(HttpStatus.FORBIDDEN, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	// 会話（FN-06・FN-12 9 章。M-27）
	CONVERSATION_NOT_FOUND(HttpStatus.NOT_FOUND, "このチャンネルは見つからないか、参加していません。"),

	// チャンネル（FN-06 9 章。M-24・M-25・M-49）
	CHANNEL_NAME_INVALID(HttpStatus.BAD_REQUEST, "チャンネル名は空白を含まない 1〜80 文字で入力してください。"),

	CHANNEL_NAME_TAKEN(HttpStatus.CONFLICT, "この名前のチャンネルはすでにあります。"),

	// 招待しようとした人がワークスペースにいない
	USER_NOT_FOUND(HttpStatus.NOT_FOUND, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	// プライベートチャンネル・DM に参加 API を送った
	PRIVATE_CHANNEL(HttpStatus.FORBIDDEN, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	// 公開チャンネル・DM に招待 API を送った
	NOT_PRIVATE_CHANNEL(HttpStatus.FORBIDDEN, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	CANNOT_LEAVE_GENERAL(HttpStatus.FORBIDDEN, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	CANNOT_DELETE_GENERAL(HttpStatus.FORBIDDEN, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	NOT_OWNER(HttpStatus.FORBIDDEN, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	// DM（FN-12 9 章。M-36）。自分との DM は画面では始められないので、画面には出さない
	CANNOT_DM_SELF(HttpStatus.BAD_REQUEST, "入力が正しくありません。"),

	// 画面は入力欄の代わりに M-36（相手の表示名を入れる）を出す
	DM_PARTNER_LEFT(HttpStatus.FORBIDDEN, "相手がこのワークスペースにいないため、メッセージを送れません。"),

	// メッセージ（FN-07 9 章。M-30・M-35・M-49）。本文が空のときは画面では送れないので、画面には出さない
	MESSAGE_EMPTY(HttpStatus.BAD_REQUEST, "メッセージを入力してください。"),

	MESSAGE_TOO_LONG(HttpStatus.BAD_REQUEST, "メッセージは 4,000 文字までです。"),

	NOT_CHANNEL_MEMBER(HttpStatus.FORBIDDEN, "このチャンネルに参加すると、メッセージを送れます。"),

	NOT_AUTHOR(HttpStatus.FORBIDDEN, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	MESSAGE_NOT_FOUND(HttpStatus.NOT_FOUND, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	// 画面を通さずに送られた、条件に合わない入力（JSON が読めない、上限を超えた文字数など）
	BAD_REQUEST(HttpStatus.BAD_REQUEST, "入力が正しくありません。"),

	// 他人のものを変えようとした、CSRF トークンが合わないとき。画面には M-49 を出す
	FORBIDDEN(HttpStatus.FORBIDDEN, "操作に失敗しました。時間をおいてもう一度お試しください。"),

	NOT_FOUND(HttpStatus.NOT_FOUND, "見つかりません。"),

	// 思いがけない失敗（M-49）
	INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "操作に失敗しました。時間をおいてもう一度お試しください。");

	private final HttpStatus status;

	private final String message;

	ErrorCode(HttpStatus status, String message) {
		this.status = status;
		this.message = message;
	}

	public HttpStatus status() {
		return this.status;
	}

	public String message() {
		return this.message;
	}

}
