package com.example.raisechat.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;

import com.example.raisechat.TestcontainersConfiguration;

// クエリの値が UTF-8 として読めないときは、入力の誤りとして 400 を返す（機能定義書 3.3。#63）。
// クエリを読むのは Tomcat なので、MockMvc ではなく実際に HTTP で確かめる。
// サーバーはテストの間だけ空いているポートで起動する（開発用の 8080 とはぶつからない）
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
class InvalidQueryEncodingTests {

	@LocalServerPort
	int port;

	@Test
	void クエリがUTF_8として読めないときは400を返す() throws Exception {
		// 「検索」を cp932 にしたバイト列（Windows の Git Bash の curl から送るとこうなる）
		HttpResponse<String> response = HttpClient.newHttpClient()
			.send(HttpRequest
				.newBuilder(URI
					.create("http://localhost:" + this.port + "/api/auth/username-availability?username=%8C%9F%8D%F5"))
				.GET()
				.build(), HttpResponse.BodyHandlers.ofString());

		assertThat(response.statusCode()).isEqualTo(400);
		assertThat(response.body()).contains("\"code\":\"BAD_REQUEST\"");
	}

}
