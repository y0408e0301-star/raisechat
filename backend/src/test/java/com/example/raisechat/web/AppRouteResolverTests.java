package com.example.raisechat.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

// 画面の URL なら index.html を返し、API・ないファイルは 404 のままにする
class AppRouteResolverTests {

	@ParameterizedTest
	@ValueSource(strings = { "", "login", "signup", "invite/abcDEF123", "settings/profile", "w/1", "w/1/c/2", "w/1/d/3",
			"w/1/search", "w/1/mentions", "w/1/channels", "w/1/members", "w/1/invites", "apiary", "wsx", "w/api" })
	void 画面のURL(String path) {
		assertThat(FrontendConfig.AppRouteResolver.isAppRoute(path)).isTrue();
	}

	@ParameterizedTest
	@ValueSource(strings = { "api", "api/workspaces", "api/unknown", "ws", "ws/info", "actuator", "actuator/health",
			"favicon.ico", "assets/index-1234.js", "w/taro.y", "robots.txt" })
	void 画面のURLではない(String path) {
		assertThat(FrontendConfig.AppRouteResolver.isAppRoute(path)).isFalse();
	}

}
