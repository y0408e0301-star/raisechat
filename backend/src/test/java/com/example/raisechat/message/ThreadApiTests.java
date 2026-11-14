package com.example.raisechat.message;

import static com.example.raisechat.ApiTestSupport.createWorkspace;
import static com.example.raisechat.ApiTestSupport.delete;
import static com.example.raisechat.ApiTestSupport.get;
import static com.example.raisechat.ApiTestSupport.join;
import static com.example.raisechat.ApiTestSupport.patch;
import static com.example.raisechat.ApiTestSupport.post;
import static com.example.raisechat.ApiTestSupport.readLong;
import static com.example.raisechat.ApiTestSupport.signup;
import static com.example.raisechat.ControllerTestSupport.assertError;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
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

// スレッド（機能定義書 FN-08）を、API を通して確かめる。10 章の「テストの観点」のうち API で確かめるもの
// （通知は WebSocketApiTests）。taro_y がオーナー、hanako・jiro がメンバー
@SpringBootTest
@Import({ TestcontainersConfiguration.class, MutableClock.Config.class })
@AutoConfigureMockMvc
class ThreadApiTests {

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

	private long send(Cookie user, String body) {
		MvcTestResult result = post(this.mvc, user, "/api/conversations/%d/messages".formatted(this.general),
				"{\"body\":\"%s\",\"clientId\":\"%s\"}".formatted(body, UUID.randomUUID()));
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	private MvcTestResult reply(Cookie user, long parentId, String body, String clientId) {
		return post(this.mvc, user, "/api/messages/%d/replies".formatted(parentId),
				"{\"body\":\"%s\",\"clientId\":\"%s\"}".formatted(body, clientId));
	}

	private long reply(Cookie user, long parentId, String body) {
		MvcTestResult result = reply(user, parentId, body, UUID.randomUUID().toString());
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	private MvcTestResult thread(Cookie user, long parentId, String query) {
		return get(this.mvc, user, "/api/messages/%d/replies%s".formatted(parentId, query));
	}

	// TC-08-1・TC-08-2（TH-1〜TH-3）
	@Test
	void 返信は親の件数と最後の時刻と返信した人を変え会話の一覧には出ない() {
		long parent = send(this.taro, "旅行の計画");
		this.clock.advance(Duration.ofMinutes(1));
		long first = reply(this.hanako, parent, "行きたい");
		this.clock.advance(Duration.ofMinutes(1));
		reply(this.jiro, parent, "私も");
		this.clock.advance(Duration.ofMinutes(1));
		long last = reply(this.hanako, parent, "日程は？");

		MvcTestResult list = get(this.mvc, this.taro, "/api/conversations/%d/messages".formatted(this.general));
		assertThat(list).bodyJson().extractingPath("$.items[*].id").isEqualTo(List.of((int) parent));
		assertThat(list).bodyJson().extractingPath("$.items[0].replyCount").isEqualTo(3);
		// 返信した人は、最後に返信した人から
		assertThat(list).bodyJson()
			.extractingPath("$.items[0].replyUsers[*].username")
			.isEqualTo(List.of("hanako", "jiro"));
		String lastAt = this.jdbc.queryForObject("SELECT to_char(created_at AT TIME ZONE 'UTC', "
				+ "'YYYY-MM-DD\"T\"HH24:MI:SS') FROM messages WHERE id = ?", String.class, last);
		assertThat(list).bodyJson().extractingPath("$.items[0].lastReplyAt").asString().startsWith(lastAt);

		MvcTestResult opened = thread(this.jiro, parent, "");
		assertThat(opened).hasStatusOk();
		assertThat(opened).bodyJson().extractingPath("$.parent.id").isEqualTo((int) parent);
		assertThat(opened).bodyJson()
			.extractingPath("$.items[*].id")
			.isEqualTo(List.of((int) first, (int) first + 1, (int) last));
		assertThat(opened).bodyJson().extractingPath("$.items[0].parentId").isEqualTo((int) parent);
		assertThat(opened).bodyJson().extractingPath("$.items[0].replyUsers").asList().isEmpty();
	}

	// TC-08-3（TH-5）
	@Test
	void 返信には返信できない() {
		long parent = send(this.taro, "親");
		long child = reply(this.hanako, parent, "返信");
		assertError(reply(this.taro, child, "返信の返信", UUID.randomUUID().toString()), ErrorCode.CANNOT_REPLY_TO_REPLY);
		// 返信をスレッドとして開くこともできない
		assertError(thread(this.taro, child, ""), ErrorCode.MESSAGE_NOT_FOUND);
	}

	// FN-07 5 章の 8 と同じ
	@Test
	void 同じclientIdの返信は2つにならない() {
		long parent = send(this.taro, "親");
		String clientId = UUID.randomUUID().toString();
		long first = readLong(reply(this.hanako, parent, "1 回目", clientId), "$.id");
		MvcTestResult again = reply(this.hanako, parent, "1 回目", clientId);
		assertThat(again).hasStatus(HttpStatus.CREATED);
		assertThat(readLong(again, "$.id")).isEqualTo(first);
		assertThat(this.jdbc.queryForObject("SELECT reply_count FROM messages WHERE id = ?", Integer.class, parent))
			.isEqualTo(1);
		// ほかの親への返信やメッセージとして同じ clientId を送るのは入力の誤り
		long other = send(this.taro, "別の親");
		assertError(reply(this.hanako, other, "x", clientId), ErrorCode.BAD_REQUEST, "clientId");
		assertError(post(this.mvc, this.hanako, "/api/conversations/%d/messages".formatted(this.general),
				"{\"body\":\"x\",\"clientId\":\"%s\"}".formatted(clientId)), ErrorCode.BAD_REQUEST, "clientId");
	}

	// TC-08-4（TH-4、BR-8）
	@Test
	void 返信を消すと親の件数と最後の時刻が直る() {
		long parent = send(this.taro, "親");
		this.clock.advance(Duration.ofMinutes(1));
		long first = reply(this.hanako, parent, "1");
		this.clock.advance(Duration.ofMinutes(1));
		long second = reply(this.jiro, parent, "2");
		String firstAt = this.jdbc.queryForObject("SELECT created_at::text FROM messages WHERE id = ?", String.class,
				first);

		assertThat(delete(this.mvc, this.jiro, "/api/messages/" + second)).hasStatus(HttpStatus.NO_CONTENT);

		assertThat(this.jdbc.queryForObject("SELECT reply_count FROM messages WHERE id = ?", Integer.class, parent))
			.isEqualTo(1);
		assertThat(
				this.jdbc.queryForObject("SELECT last_reply_at::text FROM messages WHERE id = ?", String.class, parent))
			.isEqualTo(firstAt);
		// オーナーはほかの人の返信も消せる。返信がなくなったら最後の時刻もなくなる
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + first)).hasStatus(HttpStatus.NO_CONTENT);
		assertThat(this.jdbc.queryForMap("SELECT reply_count, last_reply_at FROM messages WHERE id = ?", parent))
			.containsEntry("reply_count", 0)
			.containsEntry("last_reply_at", null);
	}

	@Test
	void 返信の編集は本人だけ() {
		long parent = send(this.taro, "親");
		long child = reply(this.hanako, parent, "返信");
		assertThat(patch(this.mvc, this.hanako, "/api/messages/" + child, "{\"body\":\"直した\"}")).hasStatusOk();
		assertError(patch(this.mvc, this.taro, "/api/messages/" + child, "{\"body\":\"x\"}"), ErrorCode.NOT_AUTHOR);
	}

	// TC-08-5（TH-7）
	@Test
	void 削除されましたの親にも返信でき最後の返信を消すと親も消える() {
		long parent = send(this.taro, "親");
		long first = reply(this.hanako, parent, "1");
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + parent)).hasStatusOk();
		long second = reply(this.jiro, parent, "削除された後の返信");

		MvcTestResult opened = thread(this.hanako, parent, "");
		assertThat(opened).bodyJson().extractingPath("$.parent.deleted").isEqualTo(true);
		assertThat(opened).bodyJson().extractingPath("$.items[*].id").isEqualTo(List.of((int) first, (int) second));

		assertThat(delete(this.mvc, this.hanako, "/api/messages/" + first)).hasStatus(HttpStatus.NO_CONTENT);
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM messages WHERE id = ?", Long.class, parent))
			.isEqualTo(1);
		assertThat(delete(this.mvc, this.jiro, "/api/messages/" + second)).hasStatus(HttpStatus.NO_CONTENT);

		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM messages", Long.class)).isZero();
		assertError(thread(this.hanako, parent, ""), ErrorCode.MESSAGE_NOT_FOUND);
	}

	// TC-08-7（TH-8）
	@Test
	void 参加していない公開チャンネルのスレッドは読めるが返信できない() {
		long channel = readLong(post(this.mvc, this.taro, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"雑談\",\"description\":\"\",\"visibility\":\"PUBLIC\"}"), "$.id");
		long parent = readLong(post(this.mvc, this.taro, "/api/conversations/%d/messages".formatted(channel),
				"{\"body\":\"雑談の親\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID())), "$.id");

		assertThat(thread(this.hanako, parent, "")).hasStatusOk();
		assertError(reply(this.hanako, parent, "x", UUID.randomUUID().toString()), ErrorCode.NOT_CHANNEL_MEMBER);
	}

	// TC-02-8 と同じく、見られない会話のスレッドは 404
	@Test
	void 見られない会話のスレッドは読めない() {
		long secret = readLong(post(this.mvc, this.taro, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"秘密\",\"description\":\"\",\"visibility\":\"PRIVATE\"}"), "$.id");
		long parent = readLong(post(this.mvc, this.taro, "/api/conversations/%d/messages".formatted(secret),
				"{\"body\":\"秘密の親\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID())), "$.id");

		assertError(thread(this.hanako, parent, ""), ErrorCode.MESSAGE_NOT_FOUND);
		assertError(reply(this.hanako, parent, "x", UUID.randomUUID().toString()), ErrorCode.MESSAGE_NOT_FOUND);
	}

	// TC-08-8（FN-08 5 章の 5）
	@Test
	void 返信は最新の50件を出し前を続けて読める() {
		long parent = send(this.taro, "親");
		List<Long> ids = IntStream.rangeClosed(1, 51).mapToObj((i) -> reply(this.hanako, parent, "返信" + i)).toList();

		MvcTestResult latest = thread(this.taro, parent, "");
		assertThat(latest).bodyJson().extractingPath("$.items.length()").isEqualTo(50);
		assertThat(latest).bodyJson().extractingPath("$.items[0].id").isEqualTo(ids.get(1).intValue());
		assertThat(latest).bodyJson().extractingPath("$.hasMoreBefore").isEqualTo(true);
		assertThat(latest).bodyJson().extractingPath("$.hasMoreAfter").isEqualTo(false);

		MvcTestResult older = thread(this.taro, parent, "?before=" + ids.get(1));
		assertThat(older).bodyJson().extractingPath("$.items[*].id").isEqualTo(List.of(ids.getFirst().intValue()));
		assertThat(older).bodyJson().extractingPath("$.hasMoreBefore").isEqualTo(false);
		assertThat(older).bodyJson().extractingPath("$.hasMoreAfter").isEqualTo(true);
	}

}
