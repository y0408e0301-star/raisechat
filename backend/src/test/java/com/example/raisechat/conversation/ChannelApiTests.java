package com.example.raisechat.conversation;

import static com.example.raisechat.ApiTestSupport.createWorkspace;
import static com.example.raisechat.ApiTestSupport.delete;
import static com.example.raisechat.ApiTestSupport.get;
import static com.example.raisechat.ApiTestSupport.join;
import static com.example.raisechat.ApiTestSupport.post;
import static com.example.raisechat.ApiTestSupport.readLong;
import static com.example.raisechat.ApiTestSupport.signup;
import static com.example.raisechat.ApiTestSupport.userId;
import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;
import java.util.stream.IntStream;

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

// チャンネルの API（機能定義書 FN-06）を、API を通して確かめる。10 章の「テストの観点」のうち API で確かめるもの。
// 招待リンク（1-7）はまだないので、ワークスペースのメンバーは SQL で入れる。taro がオーナー
@SpringBootTest
@Import({ TestcontainersConfiguration.class, MutableClock.Config.class })
@AutoConfigureMockMvc
class ChannelApiTests {

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

	private MvcTestResult create(Cookie user, String name, String visibility) {
		return post(this.mvc, user, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"%s\",\"description\":\"説明\",\"visibility\":\"%s\"}".formatted(name, visibility));
	}

	private long channel(Cookie user, String name, String visibility) {
		MvcTestResult result = create(user, name, visibility);
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	private MvcTestResult channels(Cookie user, String query) {
		return get(this.mvc, user, "/api/workspaces/%d/channels%s".formatted(this.workspace, query));
	}

	private MvcTestResult send(Cookie user, long conversationId, String body) {
		return post(this.mvc, user, "/api/conversations/%d/messages".formatted(conversationId),
				"{\"body\":\"%s\",\"clientId\":\"%s\"}".formatted(body, UUID.randomUUID()));
	}

	private static void assertError(MvcTestResult result, HttpStatus status, String code) {
		assertThat(result).hasStatus(status);
		assertThat(result).bodyJson().isLenientlyEqualTo("{\"code\":\"%s\"}".formatted(code));
	}

	private long lastRead(long conversationId, String username) {
		Long id = this.jdbc.queryForObject(
				"SELECT last_read_message_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?",
				Long.class, conversationId, userId(this.jdbc, username));
		assertThat(id).isNotNull();
		return id;
	}

	// ----------------------------------------------------------------
	// 作成（CH-2、TC-06-1・TC-06-2）

	@Test
	void 作ると自分だけがメンバーになりサイドバーに出る() {
		MvcTestResult created = create(this.hanako, "旅行の計画", "PUBLIC");

		assertThat(created).hasStatus(HttpStatus.CREATED);
		assertThat(created).bodyJson().extractingPath("$.name").isEqualTo("旅行の計画");
		assertThat(created).bodyJson().extractingPath("$.description").isEqualTo("説明");
		assertThat(created).bodyJson().extractingPath("$.memberCount").isEqualTo(1);
		assertThat(created).bodyJson().extractingPath("$.joined").isEqualTo(true);
		assertThat(created).bodyJson().extractingPath("$.canPost").isEqualTo(true);
		assertThat(created).bodyJson().extractingPath("$.createdBy.username").isEqualTo("hanako");
		assertThat(get(this.mvc, this.hanako, "/api/workspaces/%d/conversations".formatted(this.workspace))).bodyJson()
			.extractingPath("$[*].name")
			.asArray()
			.containsExactly("general", "旅行の計画");
		// ほかの人のサイドバーには出ない（CH-12）
		assertThat(get(this.mvc, this.jiro, "/api/workspaces/%d/conversations".formatted(this.workspace))).bodyJson()
			.extractingPath("$[*].name")
			.asArray()
			.containsExactly("general");
	}

	@Test
	void 名前は1文字から80文字で_空白を含むと400() {
		assertThat(create(this.taro, "a", "PUBLIC")).hasStatus(HttpStatus.CREATED);
		assertThat(create(this.taro, "あ".repeat(80), "PUBLIC")).hasStatus(HttpStatus.CREATED);
		assertError(create(this.taro, "あ".repeat(81), "PUBLIC"), HttpStatus.BAD_REQUEST, "BAD_REQUEST");
		assertError(create(this.taro, "旅行 計画", "PUBLIC"), HttpStatus.BAD_REQUEST, "CHANNEL_NAME_INVALID");
		assertError(create(this.taro, "旅行　計画", "PUBLIC"), HttpStatus.BAD_REQUEST, "CHANNEL_NAME_INVALID");
		assertError(create(this.taro, "  ", "PUBLIC"), HttpStatus.BAD_REQUEST, "CHANNEL_NAME_INVALID");
		assertError(create(this.taro, "ok", "SECRET"), HttpStatus.BAD_REQUEST, "BAD_REQUEST");
	}

	@Test
	void 同じ名前は大文字小文字を区別せず409_削除した名前はまた使える() {
		long travel = channel(this.taro, "Travel", "PUBLIC");

		assertError(create(this.hanako, "travel", "PRIVATE"), HttpStatus.CONFLICT, "CHANNEL_NAME_TAKEN");
		assertError(create(this.hanako, "general", "PUBLIC"), HttpStatus.CONFLICT, "CHANNEL_NAME_TAKEN");

		assertThat(delete(this.mvc, this.taro, "/api/conversations/" + travel)).hasStatus(HttpStatus.NO_CONTENT);
		assertThat(create(this.hanako, "travel", "PUBLIC")).hasStatus(HttpStatus.CREATED);
	}

	@Test
	void ワークスペースのメンバーでなければ作れない() {
		Cookie stranger = signup(this.mvc, "stranger");
		assertError(create(stranger, "x", "PUBLIC"), HttpStatus.NOT_FOUND, "WORKSPACE_NOT_FOUND");
	}

	// TC-06-9（API。画面は channels.test.tsx）
	@Test
	void 名前と説明は文字のまま保存する() {
		long id = readLong(post(this.mvc, this.taro, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"<script>alert(1)</script>\",\"description\":\"<b>説明</b>\",\"visibility\":\"PUBLIC\"}"),
				"$.id");
		assertThat(get(this.mvc, this.taro, "/api/conversations/" + id)).bodyJson()
			.extractingPath("$.name")
			.isEqualTo("<script>alert(1)</script>");
	}

	// ----------------------------------------------------------------
	// 一覧（CH-3、TC-06-2・TC-06-5）

	@Test
	void 一覧は公開と入っているプライベートを名前の順に出し_人数と参加中を付ける() {
		channel(this.taro, "雑談", "PUBLIC");
		channel(this.taro, "運営", "PRIVATE");
		channel(this.hanako, "Book", "PUBLIC");

		MvcTestResult forTaro = channels(this.taro, "");
		assertThat(forTaro).bodyJson()
			.extractingPath("$.items[*].name")
			.asArray()
			.containsExactly("Book", "general", "運営", "雑談");
		assertThat(forTaro).bodyJson().extractingPath("$.items[0].joined").isEqualTo(false);
		assertThat(forTaro).bodyJson().extractingPath("$.items[1].memberCount").isEqualTo(3);
		assertThat(forTaro).bodyJson().extractingPath("$.nextCursor").isNull();

		// 入っていないプライベートは、オーナーでも出ない（hanako が作った非公開を taro は見られない）
		channel(this.hanako, "内緒", "PRIVATE");
		assertThat(channels(this.taro, "")).bodyJson().extractingPath("$.items[*].name").asArray().doesNotContain("内緒");
		assertThat(channels(this.jiro, "")).bodyJson()
			.extractingPath("$.items[*].name")
			.asArray()
			.containsExactly("Book", "general", "雑談");
	}

	@Test
	void 名前で絞り込み_ワイルドカードは文字として探す() {
		channel(this.taro, "travel_2026", "PUBLIC");
		channel(this.taro, "travelX2026", "PUBLIC");
		channel(this.taro, "100%", "PUBLIC");

		assertThat(channels(this.taro, "?q=TRAVEL")).bodyJson()
			.extractingPath("$.items[*].name")
			.asArray()
			.containsExactly("travel_2026", "travelX2026");
		assertThat(channels(this.taro, "?q=_")).bodyJson()
			.extractingPath("$.items[*].name")
			.asArray()
			.containsExactly("travel_2026");
		assertThat(channels(this.taro, "?q=%")).bodyJson()
			.extractingPath("$.items[*].name")
			.asArray()
			.containsExactly("100%");
		assertError(channels(this.taro, "?q=" + "a".repeat(81)), HttpStatus.BAD_REQUEST, "BAD_REQUEST");
	}

	@Test
	void 一覧は50件ずつで_カーソルで続きを読む() throws Exception {
		IntStream.rangeClosed(1, 55).forEach((i) -> channel(this.taro, "ch%02d".formatted(i), "PUBLIC"));

		MvcTestResult first = channels(this.taro, "?q=ch");
		assertThat(first).bodyJson().extractingPath("$.items").asArray().hasSize(50);
		String next = JsonPath.read(first.getResponse().getContentAsString(StandardCharsets.UTF_8), "$.nextCursor");
		// MockMvc の uri が URL エンコードするので、そのまま渡す
		MvcTestResult second = channels(this.taro, "?q=ch&cursor=" + next);
		assertThat(second).bodyJson()
			.extractingPath("$.items[*].name")
			.asArray()
			.containsExactly("ch51", "ch52", "ch53", "ch54", "ch55");
		assertThat(second).bodyJson().extractingPath("$.nextCursor").isNull();
		assertError(channels(this.taro, "?cursor=abc"), HttpStatus.BAD_REQUEST, "BAD_REQUEST");
	}

	// ----------------------------------------------------------------
	// 参加（CH-4・CH-5、TC-06-3・TC-06-4）

	@Test
	void 参加していない公開チャンネルは読めるが送れず_参加すると送れる() {
		long chat = channel(this.taro, "雑談", "PUBLIC");
		assertThat(send(this.taro, chat, "前のメッセージ")).hasStatus(HttpStatus.CREATED);

		assertThat(get(this.mvc, this.hanako, "/api/conversations/%d/messages".formatted(chat))).hasStatusOk();
		MvcTestResult detail = get(this.mvc, this.hanako, "/api/conversations/" + chat);
		assertThat(detail).bodyJson().extractingPath("$.joined").isEqualTo(false);
		assertThat(detail).bodyJson().extractingPath("$.canPost").isEqualTo(false);
		assertError(send(this.hanako, chat, "送れない"), HttpStatus.FORBIDDEN, "NOT_CHANNEL_MEMBER");

		MvcTestResult joined = post(this.mvc, this.hanako, "/api/conversations/%d/join".formatted(chat), "{}");
		assertThat(joined).hasStatusOk();
		assertThat(joined).bodyJson().extractingPath("$.canPost").isEqualTo(true);
		assertThat(joined).bodyJson().extractingPath("$.memberCount").isEqualTo(2);
		assertThat(send(this.hanako, chat, "送れる")).hasStatus(HttpStatus.CREATED);
		// 参加する前のメッセージは未読にしない（FN-06 5 章の 2）
		Long latestBeforeJoin = this.jdbc.queryForObject("SELECT min(id) FROM messages WHERE conversation_id = ?",
				Long.class, chat);
		assertThat(lastRead(chat, "hanako")).isEqualTo(latestBeforeJoin);
		// もう一度参加しても何も変わらない
		assertThat(post(this.mvc, this.hanako, "/api/conversations/%d/join".formatted(chat), "{}")).hasStatusOk();
	}

	@Test
	void 同じ人の参加が同時に2回来ても両方成功し_1人だけ入る() {
		long chat = channel(this.taro, "雑談", "PUBLIC");
		CyclicBarrier barrier = new CyclicBarrier(2);
		List<CompletableFuture<MvcTestResult>> calls = IntStream.range(0, 2)
			.mapToObj((i) -> CompletableFuture.supplyAsync(() -> {
				try {
					barrier.await();
				}
				catch (Exception ex) {
					throw new IllegalStateException(ex);
				}
				return post(this.mvc, this.hanako, "/api/conversations/%d/join".formatted(chat), "{}");
			}))
			.toList();

		calls.stream().map(CompletableFuture::join).forEach((result) -> assertThat(result).hasStatusOk());
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM conversation_members WHERE conversation_id = ?",
				Long.class, chat))
			.isEqualTo(2);
	}

	// CH-11：入っていないプライベートチャンネルは、あるかどうかも教えない
	@Test
	void プライベートチャンネルには参加APIで入れない() {
		long secret = channel(this.taro, "運営", "PRIVATE");
		assertError(post(this.mvc, this.taro, "/api/conversations/%d/join".formatted(secret), "{}"),
				HttpStatus.FORBIDDEN, "PRIVATE_CHANNEL");
		// 入っていない人には、あるかどうかも教えない
		assertError(post(this.mvc, this.hanako, "/api/conversations/%d/join".formatted(secret), "{}"),
				HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND");
	}

	// ----------------------------------------------------------------
	// 招待（CH-7、TC-06-4・TC-06-5）

	@Test
	void プライベートチャンネルに招待すると入り_前のメッセージは未読にしない() {
		long secret = channel(this.taro, "運営", "PRIVATE");
		long message = readLong(send(this.taro, secret, "前の話"), "$.id");
		assertError(get(this.mvc, this.hanako, "/api/conversations/" + secret), HttpStatus.NOT_FOUND,
				"CONVERSATION_NOT_FOUND");

		MvcTestResult invited = post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(secret),
				"{\"usernames\":[\"HANAKO\",\"hanako\",\"taro_y\"]}");

		assertThat(invited).hasStatusOk();
		// 同じ人は 1 人にし、もう入っている人は飛ばす
		assertThat(invited).bodyJson().extractingPath("$[*].username").asArray().containsExactly("hanako");
		assertThat(get(this.mvc, this.hanako, "/api/conversations/" + secret)).hasStatusOk();
		assertThat(lastRead(secret, "hanako")).isEqualTo(message);
	}

	@Test
	void ワークスペースにいない人が含まれていたら誰も招待しない() {
		long secret = channel(this.taro, "運営", "PRIVATE");
		signup(this.mvc, "stranger");

		assertError(post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(secret),
				"{\"usernames\":[\"hanako\",\"stranger\"]}"), HttpStatus.NOT_FOUND, "USER_NOT_FOUND");
		assertError(post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(secret),
				"{\"usernames\":[\"nobody\"]}"), HttpStatus.NOT_FOUND, "USER_NOT_FOUND");
		assertError(get(this.mvc, this.hanako, "/api/conversations/" + secret), HttpStatus.NOT_FOUND,
				"CONVERSATION_NOT_FOUND");
		assertError(post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(secret), "{\"usernames\":[]}"),
				HttpStatus.BAD_REQUEST, "BAD_REQUEST");
	}

	@Test
	void 公開チャンネルには招待できない() {
		long chat = channel(this.taro, "雑談", "PUBLIC");
		assertError(post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(chat),
				"{\"usernames\":[\"hanako\"]}"), HttpStatus.FORBIDDEN, "NOT_PRIVATE_CHANNEL");
	}

	@Test
	void 招待の候補はチャンネルにいないワークスペースのメンバーで_名前で絞り込める() {
		long secret = channel(this.taro, "運営", "PRIVATE");
		signup(this.mvc, "stranger");

		assertThat(get(this.mvc, this.taro, "/api/conversations/%d/candidates".formatted(secret))).bodyJson()
			.extractingPath("$[*].username")
			.asArray()
			.containsExactly("hanako", "jiro");
		assertThat(get(this.mvc, this.taro, "/api/conversations/%d/candidates?q=JIR".formatted(secret))).bodyJson()
			.extractingPath("$[*].username")
			.asArray()
			.containsExactly("jiro");
		assertError(get(this.mvc, this.hanako, "/api/conversations/%d/candidates".formatted(secret)),
				HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND");
	}

	@Test
	void 会話のメンバーを表示名の順に出し_絞り込める() {
		MvcTestResult all = get(this.mvc, this.taro, "/api/conversations/%d/members".formatted(this.general));
		assertThat(all).bodyJson()
			.extractingPath("$.items[*].username")
			.asArray()
			.containsExactly("hanako", "jiro", "taro_y");
		assertThat(get(this.mvc, this.taro, "/api/conversations/%d/members?q=taro".formatted(this.general))).bodyJson()
			.extractingPath("$.items[*].username")
			.asArray()
			.containsExactly("taro_y");
	}

	// ----------------------------------------------------------------
	// 退出（CH-8、TC-06-6・TC-06-7）

	@Test
	void 公開チャンネルから退出しても読める() {
		long chat = channel(this.taro, "雑談", "PUBLIC");
		post(this.mvc, this.hanako, "/api/conversations/%d/join".formatted(chat), "{}");

		assertThat(post(this.mvc, this.hanako, "/api/conversations/%d/leave".formatted(chat), "{}"))
			.hasStatus(HttpStatus.NO_CONTENT);

		assertThat(get(this.mvc, this.hanako, "/api/conversations/" + chat)).bodyJson()
			.extractingPath("$.joined")
			.isEqualTo(false);
		// もう一度退出しても何も変わらない
		assertThat(post(this.mvc, this.hanako, "/api/conversations/%d/leave".formatted(chat), "{}"))
			.hasStatus(HttpStatus.NO_CONTENT);
	}

	@Test
	void プライベートチャンネルから退出すると見られなくなる() {
		long secret = channel(this.taro, "運営", "PRIVATE");
		post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(secret), "{\"usernames\":[\"hanako\"]}");

		assertThat(post(this.mvc, this.hanako, "/api/conversations/%d/leave".formatted(secret), "{}"))
			.hasStatus(HttpStatus.NO_CONTENT);

		assertError(get(this.mvc, this.hanako, "/api/conversations/" + secret), HttpStatus.NOT_FOUND,
				"CONVERSATION_NOT_FOUND");
		assertError(get(this.mvc, this.hanako, "/api/conversations/%d/messages".formatted(secret)),
				HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND");
	}

	// CH-13
	@Test
	void generalからは退出も削除もできない() {
		assertError(post(this.mvc, this.hanako, "/api/conversations/%d/leave".formatted(this.general), "{}"),
				HttpStatus.FORBIDDEN, "CANNOT_LEAVE_GENERAL");
		assertError(delete(this.mvc, this.taro, "/api/conversations/" + this.general), HttpStatus.FORBIDDEN,
				"CANNOT_DELETE_GENERAL");
	}

	// ---------------------------------------------------------------- 削除（CH-9、TC-06-8）

	// BR-3
	@Test
	void オーナーが削除するとメッセージも消え_メンバーは削除できない() {
		long chat = channel(this.hanako, "雑談", "PUBLIC");
		send(this.hanako, chat, "消える");

		assertError(delete(this.mvc, this.hanako, "/api/conversations/" + chat), HttpStatus.FORBIDDEN, "NOT_OWNER");
		assertThat(delete(this.mvc, this.taro, "/api/conversations/" + chat)).hasStatus(HttpStatus.NO_CONTENT);

		assertError(get(this.mvc, this.hanako, "/api/conversations/" + chat), HttpStatus.NOT_FOUND,
				"CONVERSATION_NOT_FOUND");
		assertThat(
				this.jdbc.queryForObject("SELECT count(*) FROM messages WHERE conversation_id = ?", Long.class, chat))
			.isZero();
	}

	// CH-11
	@Test
	void 入っていないプライベートチャンネルはオーナーでも削除できない() {
		long secret = channel(this.hanako, "内緒", "PRIVATE");
		assertError(delete(this.mvc, this.taro, "/api/conversations/" + secret), HttpStatus.NOT_FOUND,
				"CONVERSATION_NOT_FOUND");
	}

}
