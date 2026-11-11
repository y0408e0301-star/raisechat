package com.example.raisechat.workspace;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.util.List;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

import com.example.raisechat.MutableClock;
import com.example.raisechat.TestcontainersConfiguration;

import com.jayway.jsonpath.JsonPath;

import jakarta.servlet.http.Cookie;

// ワークスペースの API（機能定義書 FN-03）を、API を通して確かめる。10 章の「テストの観点」のうち 1-3 で作るもの（TC-03-1〜6）。
// 招待（1-7）はまだないので、ほかの人をメンバーにするときは SQL で入れる
@SpringBootTest
@Import({ TestcontainersConfiguration.class, MutableClock.Config.class })
@AutoConfigureMockMvc
class WorkspaceApiTests {

	@Autowired
	MockMvcTester mvc;

	@Autowired
	JdbcTemplate jdbc;

	private Cookie taro;

	@BeforeEach
	void setUp() {
		this.jdbc.execute("TRUNCATE users, refresh_tokens, workspaces RESTART IDENTITY CASCADE");
		this.taro = signup("taro_y");
	}

	private Cookie signup(String username) {
		MvcTestResult result = this.mvc.post()
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

	private MvcTestResult create(Cookie user, String name) {
		return this.mvc.post()
			.uri("/api/workspaces")
			.cookie(user)
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"name\":\"%s\"}".formatted(name))
			.exchange();
	}

	private long createId(Cookie user, String name) {
		MvcTestResult result = create(user, name);
		assertThat(result).hasStatus(HttpStatus.CREATED);
		try {
			return JsonPath.<Number>read(result.getResponse().getContentAsString(StandardCharsets.UTF_8), "$.id")
				.longValue();
		}
		catch (UnsupportedEncodingException ex) {
			throw new IllegalStateException(ex);
		}
	}

	private MvcTestResult get(Cookie user, String uri) {
		return this.mvc.get().uri(uri).cookie(user).exchange();
	}

	private long userId(String username) {
		Long id = this.jdbc.queryForObject("SELECT id FROM users WHERE username = ?", Long.class, username);
		assertThat(id).isNotNull();
		return id;
	}

	// 招待（1-7）の代わりに、ワークスペースと general に入れる（BR-6）
	private void join(long workspaceId, String username) {
		long userId = userId(username);
		this.jdbc.update("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'MEMBER')",
				workspaceId, userId);
		this.jdbc.update("INSERT INTO conversation_members (conversation_id, user_id) "
				+ "SELECT id, ? FROM conversations WHERE workspace_id = ? AND is_general", userId, workspaceId);
	}

	// TC-03-2
	@Test
	void 作ると自分がオーナーになりgeneralに自分だけが入っている() {
		MvcTestResult result = create(this.taro, " 仲間うち ");
		assertThat(result).hasStatus(HttpStatus.CREATED).bodyJson().isLenientlyEqualTo("""
				{"id":1,"name":"仲間うち","role":"OWNER","hasUnread":false,"mentionCount":0,
				 "owner":{"username":"taro_y","displayName":"taro_yの名前"},"memberCount":1,
				 "generalConversationId":1,"lastOpenedConversationId":null}
				""");

		assertThat(get(this.taro, "/api/workspaces/1/conversations")).hasStatusOk().bodyJson().isLenientlyEqualTo("""
				[{"id":1,"workspaceId":1,"type":"CHANNEL","name":"general","visibility":"PUBLIC","general":true,
				  "joined":true,"canPost":true}]
				""");
		assertThat(get(this.taro, "/api/conversations/1")).hasStatusOk().bodyJson().isLenientlyEqualTo("""
				{"name":"general","memberCount":1,"createdBy":{"username":"taro_y"}}
				""");
	}

	// TC-03-1
	@Test
	void 名前は空白だけなら400_50文字まで_ほかと同じ名前でも作れる() {
		assertThat(create(this.taro, " 　 ")).hasStatus(HttpStatus.BAD_REQUEST)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"WORKSPACE_NAME_REQUIRED\",\"field\":\"name\"}");
		assertThat(create(this.taro, "あ".repeat(50))).hasStatus(HttpStatus.CREATED);
		assertThat(create(this.taro, "あ".repeat(51))).hasStatus(HttpStatus.BAD_REQUEST)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"BAD_REQUEST\",\"field\":\"name\"}");
		assertThat(create(this.taro, "同じ名前")).hasStatus(HttpStatus.CREATED);
		assertThat(create(this.taro, "同じ名前")).hasStatus(HttpStatus.CREATED);
	}

	// TC-03-3
	@Test
	void 作れるのは10個まで() {
		IntStream.rangeClosed(1, 10)
			.forEach((i) -> assertThat(create(this.taro, "ws" + i)).hasStatus(HttpStatus.CREATED));
		assertThat(create(this.taro, "11 個目")).hasStatus(HttpStatus.CONFLICT)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"WORKSPACE_LIMIT\",\"message\":\"作れるワークスペースは 10 個までです。\"}");
		// ほかの人がオーナーのワークスペースに入っていても、数えるのは自分がオーナーのものだけ
		Cookie hanako = signup("hanako");
		assertThat(create(hanako, "はなこの")).hasStatus(HttpStatus.CREATED);
	}

	// TC-03-3（11 個目を 2 つのタブから同時に送っても 10 個を超えない）
	@Test
	void 同時に作っても10個を超えない() throws Exception {
		IntStream.rangeClosed(1, 9)
			.forEach((i) -> assertThat(create(this.taro, "ws" + i)).hasStatus(HttpStatus.CREATED));
		CyclicBarrier barrier = new CyclicBarrier(2);
		List<CompletableFuture<Integer>> calls = IntStream.range(0, 2)
			.mapToObj((i) -> CompletableFuture.supplyAsync(() -> {
				try {
					barrier.await();
				}
				catch (Exception ex) {
					throw new IllegalStateException(ex);
				}
				return create(this.taro, "同時" + i).getResponse().getStatus();
			}))
			.toList();
		List<Integer> statuses = calls.stream().map(CompletableFuture::join).sorted().toList();
		assertThat(statuses).containsExactly(201, 409);
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM workspaces", Long.class)).isEqualTo(10);
	}

	// TC-03-4
	@Test
	void 一覧は入っているものだけを名前の順に出しオーナーかを返す() {
		assertThat(get(this.taro, "/api/workspaces")).hasStatusOk().bodyJson().isStrictlyEqualTo("[]");
		Cookie hanako = signup("hanako");
		long travel = createId(hanako, "旅行サークル");
		createId(this.taro, "仲間うち");
		createId(hanako, "はなこだけ");
		join(travel, "taro_y");

		assertThat(get(this.taro, "/api/workspaces")).hasStatusOk().bodyJson().isLenientlyEqualTo("""
				[{"name":"仲間うち","role":"OWNER"},{"name":"旅行サークル","role":"MEMBER"}]
				""");
		assertThat(get(this.taro, "/api/workspaces/" + travel)).hasStatusOk().bodyJson().isLenientlyEqualTo("""
				{"role":"MEMBER","owner":{"username":"hanako"},"memberCount":2}
				""");
	}

	// TC-03-5
	@Test
	void 開いた会話を覚え_見られなくなったらなしにする() {
		long ws = createId(this.taro, "仲間うち");
		// プライベートチャンネル（1-6 の代わりに SQL で作る）
		Long secret = this.jdbc.queryForObject(
				"INSERT INTO conversations (workspace_id, type, name, visibility, "
						+ "created_by) VALUES (?, 'CHANNEL', '運営', 'PRIVATE', ?) RETURNING id",
				Long.class, ws, userId("taro_y"));
		this.jdbc.update("INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)", secret,
				userId("taro_y"));

		assertThat(read(this.taro, secret)).hasStatus(HttpStatus.NO_CONTENT);
		assertThat(get(this.taro, "/api/workspaces/" + ws)).bodyJson()
			.extractingPath("$.lastOpenedConversationId")
			.isEqualTo(secret.intValue());

		// プライベートチャンネルから抜けると見られなくなるので、なしとして返す（画面は general を開く）
		this.jdbc.update("DELETE FROM conversation_members WHERE conversation_id = ?", secret);
		assertThat(get(this.taro, "/api/workspaces/" + ws)).bodyJson()
			.extractingPath("$.lastOpenedConversationId")
			.isNull();

		// 会話が消されたら、データベースがなしにする
		assertThat(read(this.taro, 1)).hasStatus(HttpStatus.NO_CONTENT);
		this.jdbc.update("UPDATE workspace_members SET last_opened_conversation_id = ?", secret);
		this.jdbc.update("DELETE FROM conversations WHERE id = ?", secret);
		assertThat(this.jdbc.queryForObject("SELECT last_opened_conversation_id FROM workspace_members", Long.class))
			.isNull();
	}

	private MvcTestResult read(Cookie user, long conversationId) {
		return this.mvc.post()
			.uri("/api/conversations/%d/read".formatted(conversationId))
			.cookie(user)
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"lastMessageId\":0}")
			.exchange();
	}

	// TC-03-6・BR-2
	@Test
	void 入っていないワークスペースとその会話は404() {
		long ws = createId(this.taro, "仲間うち");
		Cookie hanako = signup("hanako");

		assertThat(get(hanako, "/api/workspaces/" + ws)).hasStatus(HttpStatus.NOT_FOUND)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"WORKSPACE_NOT_FOUND\",\"message\":\"このワークスペースは見つからないか、参加していません。\"}");
		assertThat(get(hanako, "/api/workspaces/999")).hasStatus(HttpStatus.NOT_FOUND);
		assertThat(get(hanako, "/api/workspaces/" + ws + "/conversations")).hasStatus(HttpStatus.NOT_FOUND);
		assertThat(get(hanako, "/api/conversations/1")).hasStatus(HttpStatus.NOT_FOUND)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"CONVERSATION_NOT_FOUND\"}");
		assertThat(read(hanako, 1)).hasStatus(HttpStatus.NOT_FOUND);

		// メンバーになれば見られる
		join(ws, "hanako");
		assertThat(get(hanako, "/api/workspaces/" + ws)).hasStatusOk();
		assertThat(get(hanako, "/api/conversations/1")).hasStatusOk()
			.bodyJson()
			.isLenientlyEqualTo("{\"joined\":true,\"memberCount\":2}");
	}

}
