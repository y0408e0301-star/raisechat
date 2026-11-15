package com.example.raisechat.reaction;

import java.util.List;

// メッセージに付いた 1 つの絵文字（機能定義書 3.5 の MessageView の reactions）。
// users は付けた人を付けた順に MAX_USERS 人まで（RE-4）。reactedByMe は見る人によって変わる
public record ReactionView(String emoji, int count, boolean reactedByMe, List<Reactor> users) {

	// 重ねたときに出す人数（RE-4）
	public static final int MAX_USERS = 20;

	// リアルタイムの通知で会話を見ている人みんなに送る形。reactedByMe は false にして送り、
	// 受け取った画面が users で直す（FN-10 5 章の 4）
	public ReactionView forEveryone() {
		return new ReactionView(this.emoji, this.count, false, this.users);
	}

	// 付けた人
	public record Reactor(String username, String displayName) {
	}

}
