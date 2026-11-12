package com.example.raisechat.realtime;

import org.springframework.boot.context.properties.ConfigurationProperties;

// application.properties の app.web.*
// origin：画面の URL（例：https://xxxx.cloudfront.net）。WebSocket をつなぐときの Origin の確かめに使う（N-25）
@ConfigurationProperties("app.web")
public record RealtimeProperties(String origin) {

	public RealtimeProperties {
		if (origin == null || origin.isBlank()) {
			throw new IllegalArgumentException("app.web.origin（環境変数 WEB_ORIGIN）に画面の URL を入れてください");
		}
	}

}
