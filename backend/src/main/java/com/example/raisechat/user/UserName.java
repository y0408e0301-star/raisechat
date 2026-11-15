package com.example.raisechat.user;

// ユーザー ID と表示名だけの形。リアクションを付けた人（FN-10）・メンションした人（FN-11）のように、
// 1 通のメッセージに何人も並び、アバターまでは要らないところで使う
public record UserName(String username, String displayName) {

	public static UserName of(User user) {
		return new UserName(user.getUsername(), user.getDisplayName());
	}

}
