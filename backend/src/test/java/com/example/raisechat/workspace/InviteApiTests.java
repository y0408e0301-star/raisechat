package com.example.raisechat.workspace;

import static com.example.raisechat.ApiTestSupport.createWorkspace;
import static com.example.raisechat.ApiTestSupport.delete;
import static com.example.raisechat.ApiTestSupport.get;
import static com.example.raisechat.ApiTestSupport.join;
import static com.example.raisechat.ApiTestSupport.post;
import static com.example.raisechat.ApiTestSupport.readLong;
import static com.example.raisechat.ApiTestSupport.signup;
import static com.example.raisechat.ApiTestSupport.userId;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

import com.example.raisechat.MutableClock;
import com.example.raisechat.TestcontainersConfiguration;
import com.jayway.jsonpath.JsonPath;

import jakarta.servlet.http.Cookie;

// 招待リンクの API（機能定義書 FN-04）を、API を通して確かめる。10 章の「テストの観点」のうち API で確かめるもの。
// taro がオーナー、hanako がメンバー、jiro・saburo はまだワークスペースにいない
@SpringBootTest
@Import({ TestcontainersConfiguration.class, MutableClock.Config.class })
@AutoConfigureMockMvc
class InviteApiTests {

	@Autowired
	MockMvcTester mvc;

	@Autowired
	JdbcTemplate jdbc;

	@Autowired
	MutableClock clock;

	@Autowired
	InviteCleanup cleanup;

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
	}

	@AfterEach
	void tearDown() {
		this.clock.reset();
	}

	// 時刻を進めると JWT（15 分）が切れるので、ログインし直す
	private void relogin() {
		this.taro = login("taro_y");
		this.hanako = login("hanako");
		this.jiro = login("jiro");
	}

	private Cookie login(String username) {
		MvcTestResult result = this.mvc.post()
			.uri("/api/auth/login")
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"username\":\"%s\",\"password\":\"password1\"}".formatted(username))
			.exchange();
		assertThat(result).hasStatusOk();
		Cookie access = result.getResponse().getCookie("access_token");
		assertThat(access).isNotNull();
		return access;
	}

	private MvcTestResult create(Cookie user) {
		return post(this.mvc, user, "/api/workspaces/%d/invites".formatted(this.workspace), "{}");
	}

	// オーナーが作った招待リンクの、招待の文字列
	private String token() {
		MvcTestResult result = create(this.taro);
		assertThat(result).hasStatus(HttpStatus.CREATED);
		String url = read(result, "$.url");
		return url.substring(url.lastIndexOf('/') + 1);
	}

	private MvcTestResult preview(Cookie user, String token) {
		return get(this.mvc, user, "/api/invites/" + token);
	}

	private MvcTestResult previewAsGuest(String token) {
		return this.mvc.get().uri("/api/invites/" + token).exchange();
	}

	private MvcTestResult accept(Cookie user, String token) {
		return post(this.mvc, user, "/api/invites/%s/accept".formatted(token), "{}");
	}

	private MvcTestResult list(Cookie user, String query) {
		return get(this.mvc, user, "/api/workspaces/%d/invites%s".formatted(this.workspace, query));
	}

	private static String read(MvcTestResult result, String path) {
		return JsonPath.read(body(result), path);
	}

	private static String body(MvcTestResult result) {
		try {
			return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
		}
		catch (UnsupportedEncodingException ex) {
			throw new IllegalStateException(ex);
		}
	}

	private static void assertError(MvcTestResult result, HttpStatus status, String code) {
		assertThat(result).hasStatus(status);
		assertThat(result).bodyJson().isLenientlyEqualTo("{\"code\":\"%s\"}".formatted(code));
	}

	private int count(String sql, Object... args) {
		Integer n = this.jdbc.queryForObject(sql, Integer.class, args);
		assertThat(n).isNotNull();
		return n;
	}

	private boolean isWorkspaceMember(String username) {
		return count("SELECT count(*) FROM workspace_members WHERE workspace_id = ? AND user_id = ?", this.workspace,
				userId(this.jdbc, username)) == 1;
	}

	private boolean isConversationMember(long conversationId, String username) {
		return count("SELECT count(*) FROM conversation_members WHERE conversation_id = ? AND user_id = ?",
				conversationId, userId(this.jdbc, username)) == 1;
	}

	// ----------------------------------------------------------------
	// 作成・一覧・取り消し（I-1〜I-3、TC-04-1）

	@Test
	void オーナーが作ると期限は7日後で_URLは画面のURLと43文字の招待の文字列() {
		MvcTestResult created = create(this.taro);

		assertThat(created).hasStatus(HttpStatus.CREATED);
		assertThat(created).bodyJson().extractingPath("$.status").isEqualTo("ACTIVE");
		assertThat(created).bodyJson().extractingPath("$.revokedAt").isNull();
		Instant createdAt = Instant.parse(read(created, "$.createdAt"));
		assertThat(Instant.parse(read(created, "$.expiresAt"))).isEqualTo(createdAt.plus(Duration.ofDays(7)));
		assertThat(read(created, "$.url")).matches("http://localhost:5173/invite/[A-Za-z0-9_-]{43}");
		// 作るたびに違う文字列になる
		assertThat(token()).isNotEqualTo(token());
	}

	@Test
	void オーナーでないメンバーは作れず一覧も見られない_メンバーでない人は404() {
		assertError(create(this.hanako), HttpStatus.FORBIDDEN, "NOT_OWNER");
		assertError(list(this.hanako, ""), HttpStatus.FORBIDDEN, "NOT_OWNER");
		assertError(create(this.jiro), HttpStatus.NOT_FOUND, "WORKSPACE_NOT_FOUND");
		assertError(list(this.jiro, ""), HttpStatus.NOT_FOUND, "WORKSPACE_NOT_FOUND");
		assertError(this.mvc.post().uri("/api/workspaces/%d/invites".formatted(this.workspace)).with(csrf()).exchange(),
				HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
	}

	@Test
	void 一覧は作った新しい順で_状態を出し_50件ずつ() {
		int first = (int) readLong(create(this.taro), "$.id");
		int second = (int) readLong(create(this.taro), "$.id");
		this.clock.advance(Duration.ofDays(8));
		relogin();
		int third = (int) readLong(create(this.taro), "$.id");
		assertThat(delete(this.mvc, this.taro, "/api/workspaces/%d/invites/%d".formatted(this.workspace, second)))
			.hasStatus(HttpStatus.NO_CONTENT);

		MvcTestResult result = list(this.taro, "");
		assertThat(result).hasStatusOk();
		assertThat(result).bodyJson().extractingPath("$.items[*].id").asArray().containsExactly(third, second, first);
		assertThat(result).bodyJson()
			.extractingPath("$.items[*].status")
			.asArray()
			.containsExactly("ACTIVE", "REVOKED", "EXPIRED");
		assertThat(result).bodyJson().extractingPath("$.items[1].revokedAt").isNotNull();
		assertThat(result).bodyJson().extractingPath("$.nextCursor").isNull();

		IntStream.range(0, 50).forEach((i) -> create(this.taro));
		MvcTestResult page1 = list(this.taro, "");
		assertThat(page1).bodyJson().extractingPath("$.items").asArray().hasSize(50);
		String cursor = read(page1, "$.nextCursor");
		MvcTestResult page2 = list(this.taro, "?cursor=" + cursor);
		assertThat(page2).bodyJson().extractingPath("$.items[*].id").asArray().containsExactly(third, second, first);
		assertThat(page2).bodyJson().extractingPath("$.nextCursor").isNull();
		assertError(list(this.taro, "?cursor=abc"), HttpStatus.BAD_REQUEST, "BAD_REQUEST");
	}

	@Test
	void 取り消すと参加できない_ほかのワークスペースのリンクやないリンクは404() {
		String token = token();
		long id = readLong(list(this.taro, ""), "$.items[0].id");

		assertError(delete(this.mvc, this.hanako, "/api/workspaces/%d/invites/%d".formatted(this.workspace, id)),
				HttpStatus.FORBIDDEN, "NOT_OWNER");
		assertThat(delete(this.mvc, this.taro, "/api/workspaces/%d/invites/%d".formatted(this.workspace, id)))
			.hasStatus(HttpStatus.NO_CONTENT);
		// 2 回取り消しても 204
		assertThat(delete(this.mvc, this.taro, "/api/workspaces/%d/invites/%d".formatted(this.workspace, id)))
			.hasStatus(HttpStatus.NO_CONTENT);
		assertError(accept(this.jiro, token), HttpStatus.GONE, "INVITE_INVALID");

		long other = readLong(createWorkspace(this.mvc, this.hanako, "別の集まり"), "$.id");
		assertError(delete(this.mvc, this.hanako, "/api/workspaces/%d/invites/%d".formatted(other, id)),
				HttpStatus.NOT_FOUND, "INVITE_NOT_FOUND");
		assertError(delete(this.mvc, this.taro, "/api/workspaces/%d/invites/%d".formatted(this.workspace, 999)),
				HttpStatus.NOT_FOUND, "INVITE_NOT_FOUND");
	}

	// ----------------------------------------------------------------
	// 中身を見る（I-4〜I-7、TC-04-2・TC-04-4）

	@Test
	void ログインしていない人にはワークスペースの名前だけを返す() {
		String token = token();

		MvcTestResult result = previewAsGuest(token);

		assertThat(result).hasStatusOk();
		assertThat(result).bodyJson()
			.isStrictlyEqualTo("{\"workspaceName\":\"仲間うち\",\"workspaceId\":null,\"ownerDisplayName\":null,"
					+ "\"memberCount\":null,\"alreadyMember\":null}");
	}

	@Test
	void ログインしている人には_オーナー_人数_メンバーかを返す() {
		String token = token();

		assertThat(preview(this.jiro, token)).bodyJson()
			.isStrictlyEqualTo("{\"workspaceName\":\"仲間うち\",\"workspaceId\":%d,\"ownerDisplayName\":\"taro_yの名前\","
				.formatted(this.workspace) + "\"memberCount\":2,\"alreadyMember\":false}");
		assertThat(preview(this.hanako, token)).bodyJson().extractingPath("$.alreadyMember").isEqualTo(true);
	}

	@Test
	void 期限切れ_取り消し済み_文字を変えた_形が違うリンクは410で名前を返さない() {
		String token = token();
		String changed = (token.charAt(0) == 'A' ? 'B' : 'A') + token.substring(1);

		assertError(previewAsGuest(changed), HttpStatus.GONE, "INVITE_INVALID");
		assertError(preview(this.jiro, changed), HttpStatus.GONE, "INVITE_INVALID");
		assertError(preview(this.jiro, "short"), HttpStatus.GONE, "INVITE_INVALID");
		assertError(preview(this.jiro, token.substring(1) + "*"), HttpStatus.GONE, "INVITE_INVALID");
		assertThat(body(previewAsGuest(changed))).doesNotContain("仲間うち");

		// 期限の 1 分前までは使え、期限を過ぎると使えない（TC-04-4）
		this.clock.advance(Duration.ofDays(7).minusMinutes(1));
		relogin();
		assertThat(previewAsGuest(token)).hasStatusOk();
		assertThat(accept(this.jiro, token)).hasStatusOk();
		this.clock.advance(Duration.ofMinutes(1));
		assertError(previewAsGuest(token), HttpStatus.GONE, "INVITE_INVALID");
		assertError(accept(signup(this.mvc, "saburo"), token), HttpStatus.GONE, "INVITE_INVALID");
	}

	@Test
	void 期限切れのJWTでは401を返し_画面が取り直す() {
		String token = token();
		this.clock.advance(Duration.ofMinutes(16));

		assertError(preview(this.jiro, token), HttpStatus.UNAUTHORIZED, "TOKEN_EXPIRED");
	}

	@Test
	void 期限切れ以外で読めないJWTではログインしていない人として名前だけを返す() {
		String token = token();

		MvcTestResult result = preview(new Cookie("access_token", "not-a-jwt"), token);

		assertThat(result).hasStatusOk();
		assertThat(result).bodyJson().extractingPath("$.workspaceName").isEqualTo("仲間うち");
		assertThat(result).bodyJson().extractingPath("$.ownerDisplayName").isNull();
		// ほかの API では今までどおり 401
		assertError(get(this.mvc, new Cookie("access_token", "not-a-jwt"), "/api/workspaces"), HttpStatus.UNAUTHORIZED,
				"UNAUTHENTICATED");
	}

	// ----------------------------------------------------------------
	// 参加する（I-5・I-7・I-8、TC-04-3・TC-04-5〜TC-04-8）

	@Test
	void 参加するとgeneralにだけ入り_ワークスペースの詳細を返す() {
		long chat = readLong(post(this.mvc, this.taro, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"雑談\",\"visibility\":\"PUBLIC\"}"), "$.id");
		post(this.mvc, this.taro, "/api/conversations/%d/messages".formatted(this.general),
				"{\"body\":\"ようこそ\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID()));

		MvcTestResult result = accept(this.jiro, token());

		assertThat(result).hasStatusOk();
		assertThat(result).bodyJson().extractingPath("$.id").isEqualTo((int) this.workspace);
		assertThat(result).bodyJson().extractingPath("$.role").isEqualTo("MEMBER");
		assertThat(result).bodyJson().extractingPath("$.memberCount").isEqualTo(3);
		assertThat(result).bodyJson().extractingPath("$.generalConversationId").isEqualTo((int) this.general);
		assertThat(isWorkspaceMember("jiro")).isTrue();
		assertThat(isConversationMember(this.general, "jiro")).isTrue();
		assertThat(isConversationMember(chat, "jiro")).isFalse();
		// 参加する前のメッセージは未読にしない（BR-6）
		assertThat(count(
				"SELECT count(*) FROM conversation_members cm WHERE cm.conversation_id = ? AND cm.user_id = ? "
						+ "AND cm.last_read_message_id = (SELECT max(id) FROM messages WHERE conversation_id = ?)",
				this.general, userId(this.jdbc, "jiro"), this.general))
			.isEqualTo(1);
		assertThat(get(this.mvc, this.jiro, "/api/workspaces")).bodyJson()
			.extractingPath("$[*].name")
			.asArray()
			.containsExactly("仲間うち");
	}

	@Test
	void すでにメンバーなら何もせず200_2回送っても1人() {
		String token = token();

		assertThat(accept(this.hanako, token)).hasStatusOk();
		assertThat(accept(this.taro, token)).bodyJson().extractingPath("$.role").isEqualTo("OWNER");
		assertThat(accept(this.jiro, token)).hasStatusOk();
		assertThat(accept(this.jiro, token)).hasStatusOk();

		assertThat(count("SELECT count(*) FROM workspace_members WHERE workspace_id = ?", this.workspace)).isEqualTo(3);
		assertThat(count("SELECT count(*) FROM conversation_members WHERE conversation_id = ?", this.general))
			.isEqualTo(3);
	}

	@Test
	void 同時に2回送ってもメンバーは1人() throws Exception {
		String token = token();
		CyclicBarrier start = new CyclicBarrier(2);
		CompletableFuture<MvcTestResult> a = CompletableFuture.supplyAsync(() -> {
			await(start);
			return accept(this.jiro, token);
		});
		CompletableFuture<MvcTestResult> b = CompletableFuture.supplyAsync(() -> {
			await(start);
			return accept(this.jiro, token);
		});

		assertThat(a.get()).hasStatusOk();
		assertThat(b.get()).hasStatusOk();
		assertThat(count("SELECT count(*) FROM workspace_members WHERE workspace_id = ?", this.workspace)).isEqualTo(3);
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
	void 開いた後に取り消されると参加できない() {
		String token = token();
		assertThat(preview(this.jiro, token)).hasStatusOk();
		long id = readLong(list(this.taro, ""), "$.items[0].id");
		delete(this.mvc, this.taro, "/api/workspaces/%d/invites/%d".formatted(this.workspace, id));

		assertError(accept(this.jiro, token), HttpStatus.GONE, "INVITE_INVALID");
		assertThat(isWorkspaceMember("jiro")).isFalse();
	}

	@Test
	void 一つのリンクで3人が参加できる() {
		String token = token();

		assertThat(accept(this.jiro, token)).hasStatusOk();
		assertThat(accept(signup(this.mvc, "saburo"), token)).hasStatusOk();
		assertThat(accept(signup(this.mvc, "shiro"), token)).hasStatusOk();

		assertThat(count("SELECT count(*) FROM workspace_members WHERE workspace_id = ?", this.workspace)).isEqualTo(5);
	}

	@Test
	void 抜けた人もまた参加でき_generalにだけ入り直してDMは戻る() {
		// キック・退出（1-8）と DM（1-9）はまだないので、抜けた後の状態を SQL で作る：
		// ほかのチャンネルと general から外れ、DM の会話のメンバーの行は残る（BR-6）
		long chat = readLong(post(this.mvc, this.taro, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"雑談\",\"visibility\":\"PUBLIC\"}"), "$.id");
		post(this.mvc, this.hanako, "/api/conversations/%d/join".formatted(chat), "{}");
		long taroId = userId(this.jdbc, "taro_y");
		long hanakoId = userId(this.jdbc, "hanako");
		Long dm = this.jdbc.queryForObject(
				"INSERT INTO conversations (workspace_id, type, dm_user_low, dm_user_high, "
						+ "created_by) VALUES (?, 'DM', ?, ?, ?) RETURNING id",
				Long.class, this.workspace, Math.min(taroId, hanakoId), Math.max(taroId, hanakoId), taroId);
		this.jdbc.update("INSERT INTO conversation_members (conversation_id, user_id, last_read_message_id) "
				+ "VALUES (?, ?, 0), (?, ?, 0)", dm, taroId, dm, hanakoId);
		this.jdbc.update("DELETE FROM conversation_members WHERE user_id = ? AND conversation_id IN (?, ?)", hanakoId,
				this.general, chat);
		this.jdbc.update("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?", this.workspace,
				hanakoId);

		assertThat(accept(this.hanako, token())).hasStatusOk();

		assertThat(isWorkspaceMember("hanako")).isTrue();
		assertThat(isConversationMember(this.general, "hanako")).isTrue();
		assertThat(isConversationMember(chat, "hanako")).isFalse();
		assertThat(dm).isNotNull();
		assertThat(isConversationMember(dm, "hanako")).isTrue();
	}

	@Test
	void ログインしていなければ参加できない() {
		String token = token();

		assertError(this.mvc.post().uri("/api/invites/%s/accept".formatted(token)).with(csrf()).exchange(),
				HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
	}

	// ----------------------------------------------------------------
	// 1 日 1 回の片付け（BR-14、TC-04-10）

	@Test
	void 作ってから30日たったリンクを消し_消したリンクは410() {
		String old = token();
		this.clock.advance(Duration.ofDays(10));
		relogin();
		String recent = token();
		this.clock.advance(Duration.ofDays(20));
		relogin();

		this.cleanup.deleteOld();

		assertThat(list(this.taro, "")).bodyJson().extractingPath("$.items").asArray().hasSize(1);
		assertError(previewAsGuest(old), HttpStatus.GONE, "INVITE_INVALID");
		assertThat(count("SELECT count(*) FROM invites WHERE token = ?", recent)).isEqualTo(1);
	}

}
