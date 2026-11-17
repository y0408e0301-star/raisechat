package com.example.raisechat.conversation;

import static com.example.raisechat.ApiTestSupport.createWorkspace;
import static com.example.raisechat.ApiTestSupport.delete;
import static com.example.raisechat.ApiTestSupport.get;
import static com.example.raisechat.ApiTestSupport.join;
import static com.example.raisechat.ApiTestSupport.post;
import static com.example.raisechat.ApiTestSupport.put;
import static com.example.raisechat.ApiTestSupport.readLong;
import static com.example.raisechat.ApiTestSupport.signup;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

import com.example.raisechat.MutableClock;
import com.example.raisechat.TestcontainersConfiguration;
import com.jayway.jsonpath.JsonPath;

import jakarta.servlet.http.Cookie;

// DM（機能定義書 FN-12）を、API を通して確かめる。10 章の「テストの観点」のうち API で確かめるもの
// （G-16 は 1-10、検索は 1-16、未読の件数は 1-15 で足す）。taro_y がオーナー、hanako・jiro がメンバー
@SpringBootTest
@Import({ TestcontainersConfiguration.class, MutableClock.Config.class })
@AutoConfigureMockMvc
class DirectMessageApiTests {

	@Autowired
	MockMvcTester mvc;

	@Autowired
	JdbcTemplate jdbc;

	@Autowired
	MutableClock clock;

	private Cookie taro;

	private Cookie hanako;

	private Cookie jiro;

	private long workspace;

	@BeforeEach
	void setUp() {
		this.jdbc.execute("TRUNCATE users, refresh_tokens, workspaces RESTART IDENTITY CASCADE");
		this.clock.reset();
		this.taro = signup(this.mvc, "taro_y");
		this.hanako = signup(this.mvc, "hanako");
		this.jiro = signup(this.mvc, "jiro");
		this.workspace = readLong(createWorkspace(this.mvc, this.taro, "仲間うち"), "$.id");
		join(this.jdbc, this.workspace, "hanako");
		join(this.jdbc, this.workspace, "jiro");
	}

	private MvcTestResult start(Cookie user, String username) {
		return post(this.mvc, user, "/api/workspaces/%d/dms".formatted(this.workspace),
				"{\"username\":\"%s\"}".formatted(username));
	}

	private long dm(Cookie user, String username) {
		MvcTestResult result = start(user, username);
		assertThat(result.getResponse().getStatus()).isIn(200, 201);
		return readLong(result, "$.id");
	}

	private MvcTestResult send(Cookie user, long conversationId, String body) {
		return post(this.mvc, user, "/api/conversations/%d/messages".formatted(conversationId),
				"{\"body\":\"%s\",\"clientId\":\"%s\"}".formatted(body, UUID.randomUUID()));
	}

	private MvcTestResult sidebar(Cookie user) {
		return get(this.mvc, user, "/api/workspaces/%d/conversations".formatted(this.workspace));
	}

	private void kick(String username) {
		assertThat(delete(this.mvc, this.taro, "/api/workspaces/%d/members/%s".formatted(this.workspace, username)))
			.hasStatus(HttpStatus.NO_CONTENT);
	}

	private static void assertError(MvcTestResult result, HttpStatus status, String code) {
		assertThat(result).hasStatus(status);
		assertThat(result).bodyJson().isLenientlyEqualTo("{\"code\":\"%s\"}".formatted(code));
	}

	// ----------------------------------------------------------------
	// 始める（DM-2、TC-12-1）

	// TC-12-2（「メッセージを送る」で同じ DM を開く）
	@Test
	void 始めるとDMを作って2人をメンバーにし_もう一度始めると同じDMを返す() {
		MvcTestResult created = start(this.hanako, "JIRO");

		assertThat(created).hasStatus(HttpStatus.CREATED);
		assertThat(created).bodyJson()
			.isLenientlyEqualTo("{\"type\":\"DM\",\"name\":null,\"joined\":true,\"canPost\":true,\"memberCount\":2,"
					+ "\"dmPartner\":{\"username\":\"jiro\",\"displayName\":\"jiroの名前\"},"
					+ "\"createdBy\":{\"username\":\"hanako\"}}");
		long id = readLong(created, "$.id");
		MvcTestResult again = start(this.hanako, "jiro");
		assertThat(again).hasStatusOk();
		assertThat(readLong(again, "$.id")).isEqualTo(id);
		// 相手から始めても同じ DM。相手から見た相手は hanako
		MvcTestResult fromPartner = start(this.jiro, "hanako");
		assertThat(fromPartner).hasStatusOk();
		assertThat(readLong(fromPartner, "$.id")).isEqualTo(id);
		assertThat(fromPartner).bodyJson().extractingPath("$.dmPartner.username").isEqualTo("hanako");
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM conversations WHERE type = 'DM'", Integer.class))
			.isEqualTo(1);
	}

	@Test
	void 二人が同時に始めてもDMは1つ() throws Exception {
		CyclicBarrier barrier = new CyclicBarrier(2);
		CompletableFuture<Long> a = CompletableFuture.supplyAsync(() -> {
			await(barrier);
			return dm(this.hanako, "jiro");
		});
		CompletableFuture<Long> b = CompletableFuture.supplyAsync(() -> {
			await(barrier);
			return dm(this.jiro, "hanako");
		});

		assertThat(a.get()).isEqualTo(b.get());
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM conversation_members WHERE conversation_id = ?",
				Integer.class, a.get()))
			.isEqualTo(2);
	}

	private static void await(CyclicBarrier barrier) {
		try {
			barrier.await();
		}
		catch (Exception ex) {
			throw new IllegalStateException(ex);
		}
	}

	@Test
	void 自分とは始められず_ワークスペースにいない人とは404() {
		assertError(start(this.hanako, "hanako"), HttpStatus.BAD_REQUEST, "CANNOT_DM_SELF");
		signup(this.mvc, "saburo");
		assertError(start(this.hanako, "saburo"), HttpStatus.NOT_FOUND, "USER_NOT_FOUND");
		assertError(start(this.hanako, "nobody"), HttpStatus.NOT_FOUND, "USER_NOT_FOUND");
		assertError(post(this.mvc, this.hanako, "/api/workspaces/%d/dms".formatted(this.workspace), "{}"),
				HttpStatus.BAD_REQUEST, "BAD_REQUEST");
		Cookie saburo = signup(this.mvc, "shiro");
		assertError(start(saburo, "hanako"), HttpStatus.NOT_FOUND, "WORKSPACE_NOT_FOUND");
	}

	// ----------------------------------------------------------------
	// サイドバー（DM-1・DM-4、TC-12-3・TC-12-4）

	@Test
	void メッセージのないDMは作った人のサイドバーにだけ出て_最初のメッセージで相手にも出る() {
		long id = dm(this.hanako, "jiro");

		assertThat(sidebar(this.hanako)).bodyJson()
			.extractingPath("$[?(@.type == 'DM')].id")
			.asArray()
			.containsExactly((int) id);
		assertThat(sidebar(this.jiro)).bodyJson().extractingPath("$[?(@.type == 'DM')]").asArray().isEmpty();

		assertThat(send(this.hanako, id, "こんにちは")).hasStatus(HttpStatus.CREATED);

		assertThat(sidebar(this.jiro)).bodyJson()
			.extractingPath("$[?(@.type == 'DM')].dmPartner.username")
			.asArray()
			.containsExactly("hanako");
	}

	@Test
	void サイドバーはチャンネルの後ろにDMを最後のメッセージの新しい順に並べる() {
		long withJiro = dm(this.hanako, "jiro");
		long withTaro = dm(this.hanako, "taro_y");
		send(this.hanako, withJiro, "先");
		this.clock.advance(Duration.ofSeconds(1));
		send(this.hanako, withTaro, "後");

		MvcTestResult list = sidebar(this.hanako);
		assertThat(list).bodyJson().extractingPath("$[0].name").isEqualTo("general");
		assertThat(list).bodyJson()
			.extractingPath("$[?(@.type == 'DM')].id")
			.asArray()
			.containsExactly((int) withTaro, (int) withJiro);

		this.clock.advance(Duration.ofSeconds(1));
		send(this.jiro, withJiro, "返事");
		assertThat(sidebar(this.hanako)).bodyJson()
			.extractingPath("$[?(@.type == 'DM')].id")
			.asArray()
			.containsExactly((int) withJiro, (int) withTaro);
	}

	// ----------------------------------------------------------------
	// ほかの人の DM（DM-7、TC-12-5）

	@Test
	void オーナーを含むほかの人はDMを読めず送れない() {
		long id = dm(this.hanako, "jiro");
		send(this.hanako, id, "ないしょ");

		assertError(get(this.mvc, this.taro, "/api/conversations/" + id), HttpStatus.NOT_FOUND,
				"CONVERSATION_NOT_FOUND");
		assertError(get(this.mvc, this.taro, "/api/conversations/%d/messages".formatted(id)), HttpStatus.NOT_FOUND,
				"CONVERSATION_NOT_FOUND");
		assertError(send(this.taro, id, "のぞき"), HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND");
		assertThat(sidebar(this.taro)).bodyJson().extractingPath("$[?(@.type == 'DM')]").asArray().isEmpty();
		// DM にチャンネルの操作はできない（FN-06）
		assertError(post(this.mvc, this.hanako, "/api/conversations/%d/join".formatted(id), "{}"), HttpStatus.FORBIDDEN,
				"PRIVATE_CHANNEL");
	}

	@Test
	void DMではオーナーでも相手のメッセージを削除できない() {
		long id = dm(this.taro, "hanako");
		long message = readLong(send(this.hanako, id, "けさないで"), "$.id");

		assertThat(get(this.mvc, this.taro, "/api/conversations/%d/messages".formatted(id))).bodyJson()
			.extractingPath("$.items[0].canDelete")
			.isEqualTo(false);
		assertError(delete(this.mvc, this.taro, "/api/messages/" + message), HttpStatus.FORBIDDEN, "FORBIDDEN");
	}

	// ----------------------------------------------------------------
	// 相手が抜けたとき（DM-6、TC-12-6）

	// TC-05-5
	@Test
	void 相手がキックされると読めるが送れず_また参加すると送れる() {
		long id = dm(this.hanako, "jiro");
		send(this.hanako, id, "まえの話");

		kick("jiro");

		assertThat(get(this.mvc, this.hanako, "/api/conversations/" + id)).bodyJson()
			.extractingPath("$.canPost")
			.isEqualTo(false);
		assertThat(sidebar(this.hanako)).bodyJson()
			.extractingPath("$[?(@.type == 'DM')].canPost")
			.asArray()
			.containsExactly(false);
		assertThat(get(this.mvc, this.hanako, "/api/conversations/%d/messages".formatted(id))).hasStatusOk();
		assertError(send(this.hanako, id, "とどかない"), HttpStatus.FORBIDDEN, "DM_PARTNER_LEFT");
		// 抜けた本人は読めない
		assertError(get(this.mvc, this.jiro, "/api/conversations/%d/messages".formatted(id)), HttpStatus.NOT_FOUND,
				"CONVERSATION_NOT_FOUND");

		String url = JsonPath.read(
				body(post(this.mvc, this.taro, "/api/workspaces/%d/invites".formatted(this.workspace), "{}")), "$.url");
		assertThat(post(this.mvc, this.jiro,
				"/api/invites/%s/accept".formatted(url.substring(url.lastIndexOf('/') + 1)), "{}"))
			.hasStatusOk();

		assertThat(send(this.hanako, id, "おかえり")).hasStatus(HttpStatus.CREATED);
		assertThat(get(this.mvc, this.jiro, "/api/conversations/%d/messages".formatted(id))).bodyJson()
			.extractingPath("$.items[*].body")
			.asArray()
			.containsExactly("まえの話", "おかえり");
		assertThat(sidebar(this.jiro)).bodyJson()
			.extractingPath("$[?(@.type == 'DM')].id")
			.asArray()
			.containsExactly((int) id);
	}

	// ----------------------------------------------------------------
	// DM の中のスレッド・リアクション・メンション（TC-12-7。添付は AttachmentApiTests）

	@Test
	void DMでもスレッドとリアクションとメンションが使える() {
		long id = dm(this.hanako, "jiro");
		long message = readLong(send(this.hanako, id, "@jiro 見てね"), "$.id");

		assertThat(post(this.mvc, this.jiro, "/api/messages/%d/replies".formatted(message),
				"{\"body\":\"見たよ\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID())))
			.hasStatus(HttpStatus.CREATED);
		assertThat(put(this.mvc, this.jiro, "/api/messages/%d/reactions/%s".formatted(message, "👍")))
			.hasStatus2xxSuccessful();

		assertThat(get(this.mvc, this.hanako, "/api/messages/" + message)).bodyJson().isLenientlyEqualTo("""
				{"replyCount":1,"reactions":[{"emoji":"👍","count":1}]}""");
		assertThat(get(this.mvc, this.jiro, "/api/workspaces/%d/mentions".formatted(this.workspace))).bodyJson()
			.extractingPath("$.items[0].message.id")
			.isEqualTo((int) message);
	}

	private static String body(MvcTestResult result) {
		try {
			return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
		}
		catch (UnsupportedEncodingException ex) {
			throw new IllegalStateException(ex);
		}
	}

}
