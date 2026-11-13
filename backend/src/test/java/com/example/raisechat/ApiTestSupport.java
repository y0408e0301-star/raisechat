package com.example.raisechat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

import com.jayway.jsonpath.JsonPath;

import jakarta.servlet.http.Cookie;

// API のテスト（*ApiTests）で使う準備。登録してログインした Cookie を作る、JSON を送る、ワークスペースを作るなど
public final class ApiTestSupport {

	private ApiTestSupport() {
	}

	// 登録して、ログインした状態の access_token の Cookie を返す
	public static Cookie signup(MockMvcTester mvc, String username) {
		MvcTestResult result = mvc.post()
			.uri("/api/auth/signup")
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"username\":\"%s\",\"displayName\":\"%sの名前\",\"password\":\"password1\"}".formatted(username,
					username))
			.exchange();
		assertThat(result).hasStatus(HttpStatus.CREATED);
		Cookie access = result.getResponse().getCookie("access_token");
		assertThat(access).isNotNull();
		return access;
	}

	public static MvcTestResult get(MockMvcTester mvc, Cookie user, String uri) {
		return mvc.get().uri(uri).cookie(user).exchange();
	}

	public static MvcTestResult post(MockMvcTester mvc, Cookie user, String uri, String json) {
		return mvc.post()
			.uri(uri)
			.cookie(user)
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content(json)
			.exchange();
	}

	public static MvcTestResult patch(MockMvcTester mvc, Cookie user, String uri, String json) {
		return mvc.patch()
			.uri(uri)
			.cookie(user)
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content(json)
			.exchange();
	}

	public static MvcTestResult delete(MockMvcTester mvc, Cookie user, String uri) {
		return mvc.delete().uri(uri).cookie(user).with(csrf()).exchange();
	}

	// 本文つきの DELETE（ワークスペースの削除の確認の名前）
	public static MvcTestResult delete(MockMvcTester mvc, Cookie user, String uri, String json) {
		return mvc.delete()
			.uri(uri)
			.cookie(user)
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content(json)
			.exchange();
	}

	// 応答の JSON から 1 つの数値を読む
	public static long readLong(MvcTestResult result, String path) {
		try {
			return JsonPath.<Number>read(result.getResponse().getContentAsString(StandardCharsets.UTF_8), path)
				.longValue();
		}
		catch (UnsupportedEncodingException ex) {
			throw new IllegalStateException(ex);
		}
	}

	// ワークスペースを作り、その ID を返す（general の ID は generalId で読む）
	public static MvcTestResult createWorkspace(MockMvcTester mvc, Cookie user, String name) {
		MvcTestResult result = post(mvc, user, "/api/workspaces", "{\"name\":\"%s\"}".formatted(name));
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return result;
	}

	public static long userId(JdbcTemplate jdbc, String username) {
		Long id = jdbc.queryForObject("SELECT id FROM users WHERE username = ?", Long.class, username);
		assertThat(id).isNotNull();
		return id;
	}

	// 招待リンクの API を通さずに、ワークスペースと general に入れる（BR-6）
	public static void join(JdbcTemplate jdbc, long workspaceId, String username) {
		long userId = userId(jdbc, username);
		jdbc.update("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'MEMBER')", workspaceId,
				userId);
		jdbc.update("INSERT INTO conversation_members (conversation_id, user_id, last_read_message_id) "
				+ "SELECT id, ?, COALESCE((SELECT max(m.id) FROM messages m WHERE m.conversation_id = c.id), 0) "
				+ "FROM conversations c WHERE workspace_id = ? AND is_general", userId, workspaceId);
	}

}
