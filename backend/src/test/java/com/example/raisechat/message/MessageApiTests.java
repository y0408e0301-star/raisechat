package com.example.raisechat.message;

import static com.example.raisechat.ApiTestSupport.createWorkspace;
import static com.example.raisechat.ApiTestSupport.delete;
import static com.example.raisechat.ApiTestSupport.get;
import static com.example.raisechat.ApiTestSupport.join;
import static com.example.raisechat.ApiTestSupport.patch;
import static com.example.raisechat.ApiTestSupport.post;
import static com.example.raisechat.ApiTestSupport.readLong;
import static com.example.raisechat.ApiTestSupport.signup;
import static com.example.raisechat.ApiTestSupport.userId;
import static org.assertj.core.api.Assertions.assertThat;

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

import jakarta.servlet.http.Cookie;

// メッセージの API（機能定義書 FN-07）を、API を通して確かめる。10 章の「テストの観点」のうち 1-4 で作るもの。
// 招待・チャンネル・スレッドの API はまだないので、ほかの人・ほかの会話・返信は SQL で入れる
@SpringBootTest
@Import({ TestcontainersConfiguration.class, MutableClock.Config.class })
@AutoConfigureMockMvc
class MessageApiTests {

	@Autowired
	MockMvcTester mvc;

	@Autowired
	JdbcTemplate jdbc;

	private Cookie taro;

	private Cookie hanako;

	private long workspace;

	private long general;

	@BeforeEach
	void setUp() {
		this.jdbc.execute("TRUNCATE users, refresh_tokens, workspaces RESTART IDENTITY CASCADE");
		this.taro = signup(this.mvc, "taro_y");
		this.hanako = signup(this.mvc, "hanako");
		MvcTestResult created = createWorkspace(this.mvc, this.taro, "仲間うち");
		this.workspace = readLong(created, "$.id");
		this.general = readLong(created, "$.generalConversationId");
		join(this.jdbc, this.workspace, "hanako");
	}

	private MvcTestResult send(Cookie user, long conversationId, String body, String clientId) {
		return post(this.mvc, user, "/api/conversations/%d/messages".formatted(conversationId),
				"{\"body\":%s,\"clientId\":\"%s\"}".formatted(json(body), clientId));
	}

	private long send(Cookie user, String body) {
		MvcTestResult result = send(user, this.general, body, UUID.randomUUID().toString());
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	private static String json(String text) {
		return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\"";
	}

	private MvcTestResult list(Cookie user, String query) {
		return get(this.mvc, user, "/api/conversations/%d/messages%s".formatted(this.general, query));
	}

	// TC-07-1
	@Test
	void 送ると前後の空白を取りLFにそろえて保存し_送った人と自分のものかを返す() {
		MvcTestResult result = send(this.taro, this.general, "  **土曜**\r\nの集合  ", UUID.randomUUID().toString());
		assertThat(result).hasStatus(HttpStatus.CREATED).bodyJson().isLenientlyEqualTo("""
				{"conversationId":1,"parentId":null,"author":{"username":"taro_y"},"body":"**土曜**\\nの集合",
				 "replyCount":0,"editedAt":null,"deleted":false,"mine":true,"canDelete":true}
				""");
		assertThat(list(this.hanako, "")).hasStatusOk().bodyJson().isLenientlyEqualTo("""
				{"items":[{"body":"**土曜**\\nの集合","mine":false,"canDelete":false}],
				 "hasMoreBefore":false,"hasMoreAfter":false}
				""");
	}

	// TC-07-1
	@Test
	void 空白だけ_4001文字は送れない() {
		assertThat(send(this.taro, this.general, " \n ", UUID.randomUUID().toString()))
			.hasStatus(HttpStatus.BAD_REQUEST)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"MESSAGE_EMPTY\",\"field\":\"body\"}");
		assertThat(send(this.taro, this.general, "あ".repeat(4000), UUID.randomUUID().toString()))
			.hasStatus(HttpStatus.CREATED);
		assertThat(send(this.taro, this.general, "あ".repeat(4001), UUID.randomUUID().toString()))
			.hasStatus(HttpStatus.BAD_REQUEST)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"MESSAGE_TOO_LONG\",\"message\":\"メッセージは 4,000 文字までです。\"}");
		assertThat(send(this.taro, this.general, "x", "not-a-uuid")).hasStatus(HttpStatus.BAD_REQUEST)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"BAD_REQUEST\",\"field\":\"clientId\"}");
	}

	// TC-07-12
	@Test
	void 同じclientIdは2回送っても1つだけ() {
		String clientId = UUID.randomUUID().toString();
		long first = readLong(send(this.taro, this.general, "1 回目", clientId), "$.id");
		MvcTestResult again = send(this.taro, this.general, "1 回目", clientId);
		assertThat(again).hasStatus(HttpStatus.CREATED);
		assertThat(readLong(again, "$.id")).isEqualTo(first);
		// ほかの人が同じ clientId を使っても、別のメッセージになる
		assertThat(send(this.hanako, this.general, "はなこ", clientId)).hasStatus(HttpStatus.CREATED);
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM messages", Long.class)).isEqualTo(2);
	}

	// TC-07-12（応答が届く前に同じものをもう一度送った）
	@Test
	void 同じclientIdを同時に送っても1つだけ() {
		String clientId = UUID.randomUUID().toString();
		CyclicBarrier barrier = new CyclicBarrier(2);
		List<CompletableFuture<MvcTestResult>> calls = IntStream.range(0, 2)
			.mapToObj((i) -> CompletableFuture.supplyAsync(() -> {
				try {
					barrier.await();
				}
				catch (Exception ex) {
					throw new IllegalStateException(ex);
				}
				return send(this.taro, this.general, "同時", clientId);
			}))
			.toList();
		List<MvcTestResult> results = calls.stream().map(CompletableFuture::join).toList();
		assertThat(results).allSatisfy((r) -> assertThat(r).hasStatus(HttpStatus.CREATED));
		assertThat(readLong(results.get(0), "$.id")).isEqualTo(readLong(results.get(1), "$.id"));
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM messages", Long.class)).isEqualTo(1);
	}

	// TC-07-7
	@Test
	void 最新の50件を古い順に返し_前を読むと残りが出る() {
		List<Long> ids = IntStream.rangeClosed(1, 60).mapToObj((i) -> send(this.taro, "m" + i)).toList();
		MvcTestResult latest = list(this.taro, "");
		assertThat(latest).bodyJson().extractingPath("$.items.length()").isEqualTo(50);
		assertThat(latest).bodyJson().extractingPath("$.items[0].body").isEqualTo("m11");
		assertThat(latest).bodyJson().extractingPath("$.items[49].body").isEqualTo("m60");
		assertThat(latest).bodyJson().extractingPath("$.hasMoreBefore").isEqualTo(true);
		assertThat(latest).bodyJson().extractingPath("$.hasMoreAfter").isEqualTo(false);

		MvcTestResult older = list(this.taro, "?before=" + ids.get(10));
		assertThat(older).bodyJson().extractingPath("$.items.length()").isEqualTo(10);
		assertThat(older).bodyJson().extractingPath("$.items[0].body").isEqualTo("m1");
		assertThat(older).bodyJson().extractingPath("$.hasMoreBefore").isEqualTo(false);
		assertThat(older).bodyJson().extractingPath("$.hasMoreAfter").isEqualTo(true);

		MvcTestResult newer = list(this.taro, "?after=" + ids.get(54) + "&limit=3");
		assertThat(newer).bodyJson().extractingPath("$.items[*].body").isEqualTo(List.of("m56", "m57", "m58"));
		assertThat(newer).bodyJson().extractingPath("$.hasMoreBefore").isEqualTo(true);
		assertThat(newer).bodyJson().extractingPath("$.hasMoreAfter").isEqualTo(true);

		assertThat(list(this.taro, "?limit=51")).hasStatus(HttpStatus.BAD_REQUEST);
		assertThat(list(this.taro, "?limit=0")).hasStatus(HttpStatus.BAD_REQUEST);
		assertThat(list(this.taro, "?before=5&after=1")).hasStatus(HttpStatus.BAD_REQUEST);
	}

	@Test
	void 会話の一覧にはスレッドの返信を出さない() {
		long parent = send(this.taro, "親");
		this.jdbc.update(
				"INSERT INTO messages (conversation_id, user_id, parent_id, client_id, body) "
						+ "VALUES (?, ?, ?, gen_random_uuid(), '返信')",
				this.general, userId(this.jdbc, "hanako"), parent);
		assertThat(list(this.taro, "")).bodyJson().extractingPath("$.items[*].body").isEqualTo(List.of("親"));
	}

	// TC-07-9
	@Test
	void 編集すると編集済みになり_ほかの人のものはオーナーでも編集できない() {
		long mine = send(this.taro, "前");
		MvcTestResult edited = patch(this.mvc, this.taro, "/api/messages/" + mine, "{\"body\":\" 後 \"}");
		assertThat(edited).hasStatusOk().bodyJson().extractingPath("$.body").isEqualTo("後");
		assertThat(edited).bodyJson().extractingPath("$.editedAt").isNotNull();

		long hers = send(this.hanako, "はなこの");
		// taro はオーナー
		assertThat(patch(this.mvc, this.taro, "/api/messages/" + hers, "{\"body\":\"x\"}"))
			.hasStatus(HttpStatus.FORBIDDEN)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"NOT_AUTHOR\"}");
		assertThat(patch(this.mvc, this.taro, "/api/messages/" + mine, "{\"body\":\" \"}"))
			.hasStatus(HttpStatus.BAD_REQUEST);
		assertThat(patch(this.mvc, this.taro, "/api/messages/999", "{\"body\":\"x\"}")).hasStatus(HttpStatus.NOT_FOUND)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"MESSAGE_NOT_FOUND\"}");
	}

	// TC-07-10
	@Test
	void 削除は本人とオーナーだけ() {
		long tarosMessage = send(this.taro, "たろう");
		long hanakosMessage = send(this.hanako, "はなこ");
		// はなこ（オーナーでない）は、たろうのものを消せない。一覧でも消せるかを返す
		assertThat(list(this.hanako, "")).bodyJson()
			.extractingPath("$.items[*].canDelete")
			.isEqualTo(List.of(false, true));
		assertThat(delete(this.mvc, this.hanako, "/api/messages/" + tarosMessage)).hasStatus(HttpStatus.FORBIDDEN)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"FORBIDDEN\"}");
		// オーナーはほかの人のものも消せる（要件定義書 U-2）
		assertThat(list(this.taro, "")).bodyJson()
			.extractingPath("$.items[*].canDelete")
			.isEqualTo(List.of(true, true));
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + hanakosMessage)).hasStatus(HttpStatus.NO_CONTENT);
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + tarosMessage)).hasStatus(HttpStatus.NO_CONTENT);
		assertThat(list(this.taro, "")).bodyJson().extractingPath("$.items").isEqualTo(List.of());
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + tarosMessage)).hasStatus(HttpStatus.NOT_FOUND);
	}

	// TC-07-11
	@Test
	void 返信のある親は削除されましたにしてスレッドを残す() {
		long parent = send(this.taro, "親");
		this.jdbc.update(
				"INSERT INTO messages (conversation_id, user_id, parent_id, client_id, body) "
						+ "VALUES (?, ?, ?, gen_random_uuid(), '返信')",
				this.general, userId(this.jdbc, "hanako"), parent);
		this.jdbc.update("UPDATE messages SET reply_count = 1, last_reply_at = now() WHERE id = ?", parent);

		assertThat(delete(this.mvc, this.taro, "/api/messages/" + parent)).hasStatusOk()
			.bodyJson()
			.isLenientlyEqualTo("""
					{"id":%d,"body":"","deleted":true,"replyCount":1,"canDelete":false}
					""".formatted(parent));
		assertThat(list(this.taro, "")).bodyJson().extractingPath("$.items[0].deleted").isEqualTo(true);
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM messages", Long.class)).isEqualTo(2);
		// 「削除されました」はもう編集・削除できない
		assertThat(patch(this.mvc, this.taro, "/api/messages/" + parent, "{\"body\":\"x\"}"))
			.hasStatus(HttpStatus.NOT_FOUND);
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + parent)).hasStatus(HttpStatus.NOT_FOUND);
	}

	@Test
	void 参加していない公開チャンネルには送れない() {
		Long channel = this.jdbc.queryForObject(
				"INSERT INTO conversations (workspace_id, type, name, visibility, "
						+ "created_by) VALUES (?, 'CHANNEL', '雑談', 'PUBLIC', ?) RETURNING id",
				Long.class, this.workspace, userId(this.jdbc, "taro_y"));
		assertThat(send(this.hanako, channel, "x", UUID.randomUUID().toString())).hasStatus(HttpStatus.FORBIDDEN)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"NOT_CHANNEL_MEMBER\",\"message\":\"このチャンネルに参加すると、メッセージを送れます。\"}");
		// 読むことはできる
		assertThat(get(this.mvc, this.hanako, "/api/conversations/%d/messages".formatted(channel))).hasStatusOk();
	}

	// TC-07-15
	@Test
	void 見られない会話のメッセージは読めず_送れず_編集も削除もできない() {
		long message = send(this.taro, "仲間うちだけ");
		Cookie jiro = signup(this.mvc, "jiro");
		assertThat(list(jiro, "")).hasStatus(HttpStatus.NOT_FOUND)
			.bodyJson()
			.isLenientlyEqualTo("{\"code\":\"CONVERSATION_NOT_FOUND\"}");
		assertThat(send(jiro, this.general, "x", UUID.randomUUID().toString())).hasStatus(HttpStatus.NOT_FOUND);
		assertThat(patch(this.mvc, jiro, "/api/messages/" + message, "{\"body\":\"x\"}"))
			.hasStatus(HttpStatus.NOT_FOUND);
		assertThat(delete(this.mvc, jiro, "/api/messages/" + message)).hasStatus(HttpStatus.NOT_FOUND);
	}

	// FN-14 5 章の 3・4 章
	@Test
	void 既読の位置は進めるだけで戻さず_その会話の親メッセージでなければ400() {
		long first = send(this.taro, "1");
		long second = send(this.taro, "2");
		String readUri = "/api/conversations/%d/read".formatted(this.general);
		assertThat(post(this.mvc, this.hanako, readUri, "{\"lastMessageId\":%d}".formatted(second)))
			.hasStatus(HttpStatus.NO_CONTENT);
		assertThat(post(this.mvc, this.hanako, readUri, "{\"lastMessageId\":%d}".formatted(first)))
			.hasStatus(HttpStatus.NO_CONTENT);
		assertThat(this.jdbc.queryForObject(
				"SELECT last_read_message_id FROM conversation_members " + "WHERE user_id = ? AND conversation_id = ?",
				Long.class, userId(this.jdbc, "hanako"), this.general))
			.isEqualTo(second);
		assertThat(post(this.mvc, this.hanako, readUri, "{\"lastMessageId\":999}")).hasStatus(HttpStatus.BAD_REQUEST)
			.bodyJson()
			.isLenientlyEqualTo("{\"field\":\"lastMessageId\"}");
	}

}
