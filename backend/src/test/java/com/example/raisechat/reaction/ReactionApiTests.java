package com.example.raisechat.reaction;

import static com.example.raisechat.ApiTestSupport.createWorkspace;
import static com.example.raisechat.ApiTestSupport.delete;
import static com.example.raisechat.ApiTestSupport.get;
import static com.example.raisechat.ApiTestSupport.join;
import static com.example.raisechat.ApiTestSupport.post;
import static com.example.raisechat.ApiTestSupport.put;
import static com.example.raisechat.ApiTestSupport.readLong;
import static com.example.raisechat.ApiTestSupport.signup;
import static com.example.raisechat.ApiTestSupport.userId;
import static com.example.raisechat.ControllerTestSupport.assertError;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;
import java.util.stream.IntStream;

import org.junit.jupiter.api.AfterEach;
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
import com.example.raisechat.common.ErrorCode;

import jakarta.servlet.http.Cookie;

// リアクション（機能定義書 FN-10）を、API を通して確かめる。10 章の「テストの観点」のうち API で確かめるもの
// （通知は WebSocketApiTests）。taro_y がオーナー、hanako・jiro がメンバー
@SpringBootTest
@Import({ TestcontainersConfiguration.class, MutableClock.Config.class })
@AutoConfigureMockMvc
class ReactionApiTests {

	private static final String THUMBS_UP = emoji(0x1F44D);

	private static final String PARTY = emoji(0x1F389);

	private static final String HEART = emoji(0x2764, 0xFE0F);

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

	private long general;

	@BeforeEach
	void setUp() {
		this.jdbc.execute("TRUNCATE users, refresh_tokens, workspaces RESTART IDENTITY CASCADE");
		this.clock.reset();
		this.taro = signup(this.mvc, "taro_y");
		this.hanako = signup(this.mvc, "hanako");
		this.jiro = signup(this.mvc, "jiro");
		MvcTestResult created = createWorkspace(this.mvc, this.taro, "仲間うち");
		this.workspace = readLong(created, "$.id");
		this.general = readLong(created, "$.generalConversationId");
		join(this.jdbc, this.workspace, "hanako");
		join(this.jdbc, this.workspace, "jiro");
	}

	@AfterEach
	void tearDown() {
		this.clock.reset();
	}

	// 絵文字はコードポイントで書く（見えない文字 U+FE0F・U+200D をソースに直接書かないため）
	private static String emoji(int... codePoints) {
		return new String(codePoints, 0, codePoints.length);
	}

	private long send(Cookie user, long conversationId, String body) {
		MvcTestResult result = post(this.mvc, user, "/api/conversations/%d/messages".formatted(conversationId),
				"{\"body\":\"%s\",\"clientId\":\"%s\"}".formatted(body, UUID.randomUUID()));
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	private long send(Cookie user, String body) {
		return send(user, this.general, body);
	}

	// MockMvc が URL エンコードするので、絵文字はそのまま渡す
	private MvcTestResult react(Cookie user, long messageId, String emoji) {
		return put(this.mvc, user, "/api/messages/%d/reactions/%s".formatted(messageId, emoji));
	}

	private MvcTestResult unreact(Cookie user, long messageId, String emoji) {
		return delete(this.mvc, user, "/api/messages/%d/reactions/%s".formatted(messageId, emoji));
	}

	private MvcTestResult message(Cookie user, long messageId) {
		return get(this.mvc, user, "/api/messages/" + messageId);
	}

	// TC-10-1（RE-2・RE-3・RE-5）
	@Test
	void 付けると件数が増え_外すと減り_0件の絵文字は消える() {
		long id = send(this.taro, "土曜の集合は駅前で");
		MvcTestResult first = react(this.hanako, id, THUMBS_UP);
		assertThat(first).hasStatusOk();
		assertThat(first).bodyJson().isStrictlyEqualTo("""
				{"reactions":[{"emoji":"%s","count":1,"reactedByMe":true,
				 "users":[{"username":"hanako","displayName":"hanakoの名前"}]}]}
				""".formatted(THUMBS_UP));
		this.clock.advance(Duration.ofSeconds(1));
		assertThat(react(this.jiro, id, THUMBS_UP)).hasStatusOk();

		// 見る人によって reactedByMe が変わる
		MvcTestResult byTaro = message(this.taro, id);
		assertThat(byTaro).bodyJson().extractingPath("$.reactions[0].count").isEqualTo(2);
		assertThat(byTaro).bodyJson().extractingPath("$.reactions[0].reactedByMe").isEqualTo(false);
		assertThat(message(this.jiro, id)).bodyJson().extractingPath("$.reactions[0].reactedByMe").isEqualTo(true);

		MvcTestResult removed = unreact(this.hanako, id, THUMBS_UP);
		assertThat(removed).hasStatusOk();
		assertThat(removed).bodyJson().extractingPath("$.reactions[0].count").isEqualTo(1);
		assertThat(removed).bodyJson().extractingPath("$.reactions[0].reactedByMe").isEqualTo(false);
		assertThat(unreact(this.jiro, id, THUMBS_UP)).bodyJson().extractingPath("$.reactions").asArray().isEmpty();
		assertThat(message(this.taro, id)).bodyJson().extractingPath("$.reactions").asArray().isEmpty();
	}

	// TC-10-2（5 章の 1）
	@Test
	void 一人で違う絵文字をいくつも付けられ_同じ絵文字は何度送っても1つ() {
		long id = send(this.taro, "旅行の計画");
		react(this.hanako, id, THUMBS_UP);
		react(this.hanako, id, PARTY);
		react(this.hanako, id, HEART);
		assertThat(react(this.hanako, id, THUMBS_UP)).hasStatusOk();
		// 付けていないものを外しても何もしない
		assertThat(unreact(this.jiro, id, THUMBS_UP)).hasStatusOk();

		assertThat(message(this.taro, id)).bodyJson()
			.extractingPath("$.reactions[*].count")
			.isEqualTo(List.of(1, 1, 1));
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM reactions", Integer.class)).isEqualTo(3);
	}

	// TC-10-4（RE-4・RE-5）
	@Test
	void 絵文字は最初に付けられた順に_付けた人は付けた順に20人まで並ぶ() {
		long id = send(this.taro, "集合写真");
		react(this.hanako, id, PARTY);
		this.clock.advance(Duration.ofSeconds(1));
		react(this.taro, id, THUMBS_UP);
		this.clock.advance(Duration.ofSeconds(1));
		react(this.jiro, id, PARTY);
		// ほかに 21 人が 👍 を付けた（合わせて 22 人）
		this.jdbc.update("""
				INSERT INTO users (username, display_name, password_hash)
				SELECT 'u' || g, 'ゆーざー' || g, 'x' FROM generate_series(1, 21) g""");
		this.jdbc.update("""
				INSERT INTO reactions (message_id, user_id, emoji, created_at)
				SELECT ?, u.id, ?, now() + (u.id || ' seconds')::interval FROM users u WHERE u.username LIKE 'u%'""",
				id, THUMBS_UP);

		MvcTestResult result = message(this.hanako, id);
		assertThat(result).bodyJson().extractingPath("$.reactions[*].emoji").isEqualTo(List.of(PARTY, THUMBS_UP));
		assertThat(result).bodyJson()
			.extractingPath("$.reactions[0].users[*].username")
			.isEqualTo(List.of("hanako", "jiro"));
		assertThat(result).bodyJson().extractingPath("$.reactions[1].count").isEqualTo(22);
		assertThat(result).bodyJson().extractingPath("$.reactions[1].users").asArray().hasSize(20);
		assertThat(result).bodyJson().extractingPath("$.reactions[1].users[0].username").isEqualTo("taro_y");
		assertThat(result).bodyJson().extractingPath("$.reactions[1].users[1].displayName").isEqualTo("ゆーざー1");
	}

	// TC-10-5（4 章）
	@Test
	void 肌の色やZWJの絵文字は付けられ_絵文字1つでないものは400() {
		long id = send(this.taro, "家族旅行");
		String thumbsUpDark = emoji(0x1F44D, 0x1F3FF);
		String family = emoji(0x1F468, 0x200D, 0x1F469, 0x200D, 0x1F467);
		assertThat(react(this.hanako, id, thumbsUpDark)).hasStatusOk();
		assertThat(react(this.hanako, id, family)).hasStatusOk();
		// 画面の一覧が付ける U+FE0F は、一覧の形に直して保存する（同じ絵文字とみなす）
		assertThat(react(this.jiro, id, THUMBS_UP + emoji(0xFE0F))).hasStatusOk();
		assertThat(message(this.taro, id)).bodyJson()
			.extractingPath("$.reactions[*].emoji")
			.isEqualTo(List.of(thumbsUpDark, family, THUMBS_UP));

		assertError(react(this.hanako, id, "a"), ErrorCode.EMOJI_INVALID, "emoji");
		assertError(react(this.hanako, id, THUMBS_UP + PARTY), ErrorCode.EMOJI_INVALID, "emoji");
		assertError(unreact(this.hanako, id, "a"), ErrorCode.EMOJI_INVALID, "emoji");
	}

	// TC-10-6（RE-7、BR-10）
	@Test
	void 種類が50の絵文字に新しい種類は付けられず_ある絵文字には付けられる() {
		long id = send(this.taro, "人気の投稿");
		fill(id, 50);

		assertError(react(this.hanako, id, THUMBS_UP), ErrorCode.REACTION_LIMIT);
		// すでにある絵文字（😀）にはまだ付けられる
		MvcTestResult again = react(this.hanako, id, emoji(0x1F600));
		assertThat(again).hasStatusOk();
		assertThat(again).bodyJson().extractingPath("$.reactions[0].count").isEqualTo(2);
	}

	@Test
	void 種類が49のときに二人が同時に新しい種類を付けても50を超えない() throws Exception {
		long id = send(this.taro, "人気の投稿");
		fill(id, 49);
		CyclicBarrier barrier = new CyclicBarrier(2);
		CompletableFuture<MvcTestResult> a = CompletableFuture.supplyAsync(() -> {
			await(barrier);
			return react(this.hanako, id, THUMBS_UP);
		});
		CompletableFuture<MvcTestResult> b = CompletableFuture.supplyAsync(() -> {
			await(barrier);
			return react(this.jiro, id, PARTY);
		});

		List<Integer> statuses = List.of(a.get().getResponse().getStatus(), b.get().getResponse().getStatus());
		assertThat(statuses).containsExactlyInAnyOrder(200, 409);
		assertThat(this.jdbc.queryForObject("SELECT count(DISTINCT emoji) FROM reactions WHERE message_id = ?",
				Integer.class, id))
			.isEqualTo(50);
	}

	// taro_y が 😀 から順に count 種類の絵文字を付けた状態にする
	private void fill(long messageId, int count) {
		long taroId = userId(this.jdbc, "taro_y");
		IntStream.range(0, count)
			.forEach((i) -> this.jdbc.update("INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)",
					messageId, taroId, emoji(0x1F600 + i)));
	}

	private static void await(CyclicBarrier barrier) {
		try {
			barrier.await();
		}
		catch (Exception ex) {
			throw new IllegalStateException(ex);
		}
	}

	// TC-10-7（RE-7、FN-08 の返信にも付けられる）
	@Test
	void スレッドの返信にも付けられる() {
		long parent = send(this.taro, "親");
		MvcTestResult replied = post(this.mvc, this.hanako, "/api/messages/%d/replies".formatted(parent),
				"{\"body\":\"返信\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID()));
		long reply = readLong(replied, "$.id");
		assertThat(react(this.jiro, reply, THUMBS_UP)).hasStatusOk();
		assertThat(get(this.mvc, this.taro, "/api/messages/%d/replies".formatted(parent))).bodyJson()
			.extractingPath("$.items[0].reactions[0].emoji")
			.isEqualTo(THUMBS_UP);
	}

	// TC-10-7（RE-7、8 章）、TC-06-3
	@Test
	void 参加していない公開チャンネルでは付けられず_見られない会話のメッセージは404() {
		MvcTestResult channel = post(this.mvc, this.taro, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"旅行\",\"visibility\":\"PUBLIC\"}");
		long travel = readLong(channel, "$.id");
		long id = send(this.taro, travel, "行き先");
		assertError(react(this.hanako, id, THUMBS_UP), ErrorCode.NOT_CHANNEL_MEMBER);
		assertError(unreact(this.hanako, id, THUMBS_UP), ErrorCode.NOT_CHANNEL_MEMBER);

		MvcTestResult secret = post(this.mvc, this.taro, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"運営\",\"visibility\":\"PRIVATE\"}");
		long hidden = send(this.taro, readLong(secret, "$.id"), "秘密");
		assertError(react(this.hanako, hidden, THUMBS_UP), ErrorCode.MESSAGE_NOT_FOUND);
		assertError(react(this.hanako, Long.MAX_VALUE, THUMBS_UP), ErrorCode.MESSAGE_NOT_FOUND);
	}

	// FN-12 DM-6
	@Test
	void 相手がいないDMでは付けられない() {
		MvcTestResult started = post(this.mvc, this.hanako, "/api/workspaces/%d/dms".formatted(this.workspace),
				"{\"username\":\"jiro\"}");
		long dm = readLong(started, "$.id");
		long id = send(this.jiro, dm, "こんにちは");
		assertThat(delete(this.mvc, this.taro, "/api/workspaces/%d/members/jiro".formatted(this.workspace)))
			.hasStatus(HttpStatus.NO_CONTENT);
		assertError(react(this.hanako, id, THUMBS_UP), ErrorCode.DM_PARTNER_LEFT);
	}

	// 5 章の 5、BR-8
	@Test
	void 削除されましたにするとリアクションも消え_もう付けられない() {
		long parent = send(this.taro, "親");
		react(this.hanako, parent, THUMBS_UP);
		post(this.mvc, this.jiro, "/api/messages/%d/replies".formatted(parent),
				"{\"body\":\"返信\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID()));
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + parent)).hasStatusOk();

		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM reactions", Integer.class)).isZero();
		assertThat(message(this.hanako, parent)).bodyJson().extractingPath("$.reactions").asArray().isEmpty();
		assertError(react(this.hanako, parent, THUMBS_UP), ErrorCode.MESSAGE_DELETED);
	}

	@Test
	void メッセージを消すとリアクションも消える() {
		long id = send(this.taro, "消すもの");
		react(this.hanako, id, THUMBS_UP);
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + id)).hasStatus(HttpStatus.NO_CONTENT);
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM reactions", Integer.class)).isZero();
	}

	// 退出した人のリアクションは残る（FN-05 の前提）
	@Test
	void キックされた人のリアクションは残る() {
		long id = send(this.taro, "お知らせ");
		react(this.jiro, id, THUMBS_UP);
		assertThat(delete(this.mvc, this.taro, "/api/workspaces/%d/members/jiro".formatted(this.workspace)))
			.hasStatus(HttpStatus.NO_CONTENT);
		assertThat(message(this.hanako, id)).bodyJson()
			.extractingPath("$.reactions[0].users[0].username")
			.isEqualTo("jiro");
	}

}
