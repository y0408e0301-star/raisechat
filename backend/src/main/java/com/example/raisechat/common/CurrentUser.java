package com.example.raisechat.common;

import org.springframework.security.oauth2.jwt.Jwt;

// ログインしている人の ID（users.id）。JWT の sub に入っている（TokenService）
public final class CurrentUser {

	private CurrentUser() {
	}

	public static long id(Jwt jwt) {
		return Long.parseLong(jwt.getSubject());
	}

}
