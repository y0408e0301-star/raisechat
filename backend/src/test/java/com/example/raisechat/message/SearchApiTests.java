package com.example.raisechat.message;

import static com.example.raisechat.ApiTestSupport.createWorkspace;
import static com.example.raisechat.ApiTestSupport.delete;
import static com.example.raisechat.ApiTestSupport.join;
import static com.example.raisechat.ApiTestSupport.post;
import static com.example.raisechat.ApiTestSupport.readLong;
import static com.example.raisechat.ApiTestSupport.signup;
import static com.example.raisechat.ApiTestSupport.userId;
import static com.example.raisechat.ControllerTestSupport.assertError;
import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

import com.example.raisechat.TestcontainersConfiguration;
import com.example.raisechat.common.ErrorCode;
import com.jayway.jsonpath.JsonPath;

import jakarta.servlet.http.Cookie;

// メッセージ検索（機能定義書 FN-13）を、API を通して確かめる。10 章の「テストの観点」のうち API で確かめるもの。
// taro_y がオーナー、hanako・jiro がメンバー
@SpringBootTest
@Import(TestcontainersConfiguration.class)
@AutoConfigureMockMvc
class SearchApiTests {

	@Autowired
	MockMvcTester mvc;

	@Autowired
	JdbcTemplate jdbc;

	private Cookie taro;

	private Cookie hanako;

	private Cookie jiro;

	private long workspace;

	private long general;

	@BeforeEach
	void setUp() {
		this.jdbc.execute("TRUNCATE users, refresh_tokens, workspaces RESTART IDENTITY CASCADE");
		this.taro = signup(this.mvc, "taro_y");
		this.hanako = signup(this.mvc, "hanako");
		this.jiro = signup(this.mvc, "jiro");
		MvcTestResult created = createWorkspace(this.mvc, this.taro, "仲間うち");
		this.workspace = readLong(created, "$.id");
		this.general = readLong(created, "$.generalConversationId");
		join(this.jdbc, this.workspace, "hanako");
		join(this.jdbc, this.workspace, "jiro");
	}

	private long send(Cookie user, long conversationId, String body) {
		MvcTestResult result = post(this.mvc, user, "/api/conversations/%d/messages".formatted(conversationId),
				"{\"body\":\"%s\",\"clientId\":\"%s\"}".formatted(body, UUID.randomUUID()));
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	private long channel(String name, String visibility) {
		MvcTestResult result = post(this.mvc, this.taro, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"%s\",\"visibility\":\"%s\"}".formatted(name, visibility));
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	private long dm(Cookie user, String username) {
		return readLong(post(this.mvc, user, "/api/workspaces/%d/dms".formatted(this.workspace),
				"{\"username\":\"%s\"}".formatted(username)), "$.id");
	}

	// extra は「&名前=値」をつないだもの。値は英数字だけ
	private MvcTestResult search(Cookie user, String q, String extra) {
		MockMvcTester.MockMvcRequestBuilder request = this.mvc.get()
			.uri("/api/workspaces/{ws}/search", this.workspace)
			.cookie(user)
			.param("q", q);
		for (String pair : extra.split("&")) {
			if (!pair.isEmpty()) {
				request = request.param(pair.substring(0, pair.indexOf('=')), pair.substring(pair.indexOf('=') + 1));
			}
		}
		return request.exchange();
	}

	private List<Integer> ids(MvcTestResult result) {
		return JsonPath.read(content(result), "$.items[*].message.id");
	}

	private static String content(MvcTestResult result) {
		try {
			return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
		}
		catch (Exception ex) {
			throw new IllegalStateException(ex);
		}
	}

	// TC-13-1・TC-13-2（SR-2、5 章の 3）
	@Test
	void 見られる会話だけを探し_新しい順に返す() {
		long travel = channel("旅行", "PUBLIC");
		long secret = channel("運営", "PRIVATE");
		long ours = dm(this.hanako, "jiro");
		long theirs = dm(this.taro, "jiro");
		long inGeneral = send(this.taro, this.general, "集合は駅前");
		long inTravel = send(this.taro, travel, "集合は空港");
		long inSecret = send(this.taro, secret, "集合は秘密");
		long inOurDm = send(this.jiro, ours, "集合は家");
		send(this.taro, theirs, "集合はほかの DM");
		MvcTestResult replied = post(this.mvc, this.jiro, "/api/messages/%d/replies".formatted(inGeneral),
				"{\"body\":\"集合の返信\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID()));
		long reply = readLong(replied, "$.id");
		// ほかのワークスペースのメッセージ
		long other = readLong(createWorkspace(this.mvc, this.hanako, "別の"), "$.generalConversationId");
		send(this.hanako, other, "集合はほかのワークスペース");

		MvcTestResult result = search(this.hanako, "集合", "");
		assertThat(result).hasStatusOk();
		// 参加していない公開チャンネル（旅行）・自分の DM・スレッドの返信は見つかる。入っていないプライベートチャンネル・ほかの人の DM・
		// ほかのワークスペースは見つからない
		assertThat(ids(result)).containsExactly((int) reply, (int) inOurDm, (int) inTravel, (int) inGeneral);
		assertThat(result).bodyJson().extractingPath("$.items[0].message.parentId").isEqualTo((int) inGeneral);
		assertThat(result).bodyJson().extractingPath("$.items[1].conversation.type").isEqualTo("DM");
		assertThat(result).bodyJson().extractingPath("$.items[1].conversation.dmPartner.username").isEqualTo("jiro");
		assertThat(result).bodyJson().extractingPath("$.items[2].conversation.name").isEqualTo("旅行");
		assertThat(result).bodyJson().extractingPath("$.nextCursor").isNull();

		// 見られない会話で絞り込むと 404
		assertError(search(this.hanako, "集合", "&conversationId=" + secret), ErrorCode.CONVERSATION_NOT_FOUND);
		assertError(search(this.hanako, "集合", "&conversationId=" + theirs), ErrorCode.CONVERSATION_NOT_FOUND);
		assertError(search(this.hanako, "集合", "&conversationId=" + other), ErrorCode.CONVERSATION_NOT_FOUND);
		// プライベートチャンネルのメンバーには見つかる
		assertThat(ids(search(this.taro, "秘密", ""))).containsExactly((int) inSecret);
	}

	// TC-13-3（SR-3、5 章の 2）
	@Test
	void 大文字小文字を区別せず_空白で区切った言葉をすべて含むものだけ_記号はただの文字() {
		long tokyo = send(this.taro, this.general, "tokyo で集合");
		long both = send(this.taro, this.general, "土曜の**集合**は駅前で");
		send(this.taro, this.general, "駅前だけ");
		long percent = send(this.taro, this.general, "達成率 100% です");
		send(this.taro, this.general, "達成率 1000 です");
		long underscore = send(this.taro, this.general, "file_name を見て");
		send(this.taro, this.general, "filexname を見て");

		assertThat(ids(search(this.hanako, "Tokyo", ""))).containsExactly((int) tokyo);
		// 全角の空白で区切っても AND
		assertThat(ids(search(this.hanako, "集合　駅前", ""))).containsExactly((int) both);
		assertThat(ids(search(this.hanako, "100%", ""))).containsExactly((int) percent);
		assertThat(ids(search(this.hanako, "file_name", ""))).containsExactly((int) underscore);
	}

	// TC-13-4（SR-2）
	@Test
	void 削除したメッセージと削除されましたは出ない() {
		long parent = send(this.taro, this.general, "消す親");
		post(this.mvc, this.jiro, "/api/messages/%d/replies".formatted(parent),
				"{\"body\":\"返信\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID()));
		long gone = send(this.taro, this.general, "消すメッセージ");
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + parent)).hasStatusOk();
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + gone)).hasStatus(HttpStatus.NO_CONTENT);
		assertThat(ids(search(this.hanako, "消す", ""))).isEmpty();
	}

	// TC-13-5（SR-5）
	@Test
	void 会話と送った人で絞り込め_抜けた人のメッセージも探せる() {
		long travel = channel("旅行", "PUBLIC");
		send(this.taro, this.general, "予定 A");
		long jiros = send(this.jiro, this.general, "予定 B");
		long inTravel = send(this.taro, travel, "予定 C");

		assertThat(ids(search(this.hanako, "予定", "&conversationId=" + travel))).containsExactly((int) inTravel);
		assertThat(ids(search(this.hanako, "予定", "&from=JIRO"))).containsExactly((int) jiros);
		assertThat(ids(search(this.hanako, "予定", "&from=nobody"))).isEmpty();

		assertThat(delete(this.mvc, this.taro, "/api/workspaces/%d/members/jiro".formatted(this.workspace)))
			.hasStatus(HttpStatus.NO_CONTENT);
		assertThat(ids(search(this.hanako, "予定", "&from=jiro"))).containsExactly((int) jiros);
	}

	// TC-13-7（4 章）、8 章
	@Test
	void 空の文字は400_101文字は400_メンバーでなければ404() {
		assertError(search(this.hanako, "   ", ""), ErrorCode.QUERY_REQUIRED, "q");
		assertError(search(this.hanako, "あ".repeat(101), ""), ErrorCode.BAD_REQUEST, "q");
		assertThat(search(this.hanako, "あ".repeat(100), "")).hasStatusOk();
		Cookie stranger = signup(this.mvc, "stranger");
		assertError(search(stranger, "集合", ""), ErrorCode.WORKSPACE_NOT_FOUND);
	}

	// TC-13-8（SR-1）
	@Test
	void 新しい順に20件ずつ読める() {
		long taroId = userId(this.jdbc, "taro_y");
		for (int i = 0; i < 25; i++) {
			this.jdbc.update(
					"INSERT INTO messages (conversation_id, user_id, client_id, body) VALUES (?, ?, gen_random_uuid(), ?)",
					this.general, taroId, "お知らせ " + i);
		}
		MvcTestResult first = search(this.hanako, "お知らせ", "");
		assertThat(ids(first)).hasSize(20);
		assertThat(first).bodyJson().extractingPath("$.items[0].message.body").isEqualTo("お知らせ 24");
		String next = JsonPath.read(content(first), "$.nextCursor");
		MvcTestResult rest = search(this.hanako, "お知らせ", "&cursor=" + next);
		assertThat(ids(rest)).hasSize(5);
		assertThat(rest).bodyJson().extractingPath("$.items[4].message.body").isEqualTo("お知らせ 0");
		assertThat(rest).bodyJson().extractingPath("$.nextCursor").isNull();
	}

	// 5 章の 4、データ設計書 8.3：日本語の言葉でも本文の GIN の索引（pg_trgm）を使える。
	// テストのデータは少なく、ふだんは全件を読むほうが速いと判断されるので、全件を読む計画を止めて確かめる
	@Test
	void 日本語の言葉で本文の索引を使える() {
		send(this.taro, this.general, "土曜の集合場所は駅前です");
		List<String> plan = this.jdbc.execute((ConnectionCallback<List<String>>) (connection) -> {
			try (Statement statement = connection.createStatement()) {
				statement.execute("SET enable_seqscan = off");
				List<String> lines = new ArrayList<>();
				try (ResultSet rs = statement
					.executeQuery("EXPLAIN SELECT id FROM messages WHERE body ILIKE '%集合場所%'")) {
					while (rs.next()) {
						lines.add(rs.getString(1));
					}
				}
				statement.execute("RESET enable_seqscan");
				return lines;
			}
		});
		assertThat(String.join("\n", plan)).contains("messages_body_trgm_idx");
		// 日本語の文字が索引の言葉（trigram）になる（LC_CTYPE が C だとならない。技術スタック定義書）
		assertThat(this.jdbc.queryForObject("SELECT array_length(show_trgm('集合場所'), 1)", Integer.class))
			.isGreaterThan(0);
	}

}
