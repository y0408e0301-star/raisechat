package com.example.raisechat.unread;

import static com.example.raisechat.ApiTestSupport.createWorkspace;
import static com.example.raisechat.ApiTestSupport.delete;
import static com.example.raisechat.ApiTestSupport.get;
import static com.example.raisechat.ApiTestSupport.join;
import static com.example.raisechat.ApiTestSupport.patch;
import static com.example.raisechat.ApiTestSupport.post;
import static com.example.raisechat.ApiTestSupport.readLong;
import static com.example.raisechat.ApiTestSupport.signup;
import static com.example.raisechat.ApiTestSupport.userId;
import static com.example.raisechat.ControllerTestSupport.assertError;
import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
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

import com.example.raisechat.TestcontainersConfiguration;
import com.example.raisechat.common.ErrorCode;
import com.jayway.jsonpath.JsonPath;

import jakarta.servlet.http.Cookie;

// 通知（機能定義書 FN-14）の件数・既読・メンションの一覧と、メッセージの位置を開く（FN-07 MS-14）を、API を通して確かめる。
// リアルタイムの通知は WebSocketApiTests。taro_y がオーナー、hanako・jiro がメンバー
@SpringBootTest
@Import(TestcontainersConfiguration.class)
@AutoConfigureMockMvc
class NotificationApiTests {

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

	private long reply(Cookie user, long parentId, String body) {
		MvcTestResult result = post(this.mvc, user, "/api/messages/%d/replies".formatted(parentId),
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
		MvcTestResult result = post(this.mvc, user, "/api/workspaces/%d/dms".formatted(this.workspace),
				"{\"username\":\"%s\"}".formatted(username));
		return readLong(result, "$.id");
	}

	private MvcTestResult sidebar(Cookie user) {
		return get(this.mvc, user, "/api/workspaces/%d/conversations".formatted(this.workspace));
	}

	private MvcTestResult read(Cookie user, long conversationId, long lastMessageId) {
		return post(this.mvc, user, "/api/conversations/%d/read".formatted(conversationId),
				"{\"lastMessageId\":%d}".formatted(lastMessageId));
	}

	private MvcTestResult workspaces(Cookie user) {
		return get(this.mvc, user, "/api/workspaces");
	}

	private MvcTestResult mentions(Cookie user, String query) {
		return get(this.mvc, user, "/api/workspaces/%d/mentions%s".formatted(this.workspace, query));
	}

	private String path(long conversationId, String field) {
		return "$[?(@.id == %d)].%s".formatted(conversationId, field);
	}

	// TC-14-1・TC-14-10（NT-1・NT-10、5 章の 1）
	@Test
	void ほかの人のメッセージは未読になり_自分のものと削除されましたは数えない() {
		long first = send(this.taro, this.general, "1");
		send(this.taro, this.general, "2");
		send(this.hanako, this.general, "自分の");

		MvcTestResult result = sidebar(this.hanako);
		assertThat(result).bodyJson().extractingPath(path(this.general, "unreadCount")).isEqualTo(List.of(2));
		assertThat(result).bodyJson().extractingPath(path(this.general, "hasUnread")).isEqualTo(List.of(true));
		// 送った本人には未読にならない
		assertThat(sidebar(this.taro)).bodyJson()
			.extractingPath(path(this.general, "unreadCount"))
			.isEqualTo(List.of(1));

		// 返信のある親を「削除されました」にすると数えない
		reply(this.jiro, first, "返信");
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + first)).hasStatusOk();
		assertThat(sidebar(this.hanako)).bodyJson()
			.extractingPath(path(this.general, "unreadCount"))
			.isEqualTo(List.of(1));
	}

	// TC-14-1（100 件以上は 100。画面は「99+」）
	@Test
	void 未読は100件まで数える() {
		long taroId = userId(this.jdbc, "taro_y");
		IntStream.range(0, 120)
			.forEach((i) -> this.jdbc.update(
					"INSERT INTO messages (conversation_id, user_id, client_id, body) VALUES (?, ?, gen_random_uuid(), ?)",
					this.general, taroId, "m" + i));
		assertThat(sidebar(this.hanako)).bodyJson()
			.extractingPath(path(this.general, "unreadCount"))
			.isEqualTo(List.of(100));
	}

	// TC-14-1（DM は件数を出す）
	@Test
	void DMの未読の件数() {
		long id = dm(this.hanako, "jiro");
		send(this.hanako, id, "やあ");
		send(this.hanako, id, "元気？");
		assertThat(sidebar(this.jiro)).bodyJson().extractingPath(path(id, "unreadCount")).isEqualTo(List.of(2));
	}

	// TC-14-2・TC-14-3（NT-2・NT-4、BR-15）
	@Test
	void 返信は未読にならず_返信の中のメンションはスレッドを読むまで数える() {
		long parent = send(this.taro, this.general, "@hanako 親");
		read(this.hanako, this.general, parent);
		long r = reply(this.jiro, parent, "@hanako 返信");

		MvcTestResult result = sidebar(this.hanako);
		assertThat(result).bodyJson().extractingPath(path(this.general, "unreadCount")).isEqualTo(List.of(0));
		assertThat(result).bodyJson().extractingPath(path(this.general, "mentionCount")).isEqualTo(List.of(1));

		assertThat(post(this.mvc, this.hanako, "/api/messages/%d/thread-read".formatted(parent), "{}"))
			.hasStatus(HttpStatus.NO_CONTENT);
		assertThat(sidebar(this.hanako)).bodyJson()
			.extractingPath(path(this.general, "mentionCount"))
			.isEqualTo(List.of(0));
		// 返信をスレッドとして読むことはできない
		assertError(post(this.mvc, this.hanako, "/api/messages/%d/thread-read".formatted(r), "{}"),
				ErrorCode.MESSAGE_NOT_FOUND);
	}

	// TC-14-3（NT-4、5 章の 3、BR-15）
	@Test
	void 読むと未読が消え_読んだ位置より後のメンションは残り_位置は戻らない() {
		long first = send(this.taro, this.general, "@hanako 1");
		long second = send(this.taro, this.general, "@hanako 2");
		assertThat(read(this.hanako, this.general, first)).hasStatus(HttpStatus.NO_CONTENT);

		MvcTestResult result = sidebar(this.hanako);
		assertThat(result).bodyJson().extractingPath(path(this.general, "unreadCount")).isEqualTo(List.of(1));
		assertThat(result).bodyJson().extractingPath(path(this.general, "mentionCount")).isEqualTo(List.of(1));

		read(this.hanako, this.general, second);
		read(this.hanako, this.general, first);
		MvcTestResult after = sidebar(this.hanako);
		assertThat(after).bodyJson().extractingPath(path(this.general, "unreadCount")).isEqualTo(List.of(0));
		assertThat(after).bodyJson().extractingPath(path(this.general, "mentionCount")).isEqualTo(List.of(0));
	}

	// TC-14-5（NT-3、5 章の 4）
	@Test
	void ワークスペースの一覧に未読の有無とメンションの合計を出し_参加していない公開チャンネルのメンションも数える() {
		long travel = channel("旅行", "PUBLIC");
		send(this.taro, travel, "@hanako 行く？");
		send(this.taro, this.general, "@hanako こんにちは");

		MvcTestResult result = workspaces(this.hanako);
		assertThat(result).bodyJson().extractingPath("$[0].hasUnread").isEqualTo(true);
		assertThat(result).bodyJson().extractingPath("$[0].mentionCount").isEqualTo(2);
		// ワークスペースの詳細（ヘッダーの「@」）も同じ
		assertThat(get(this.mvc, this.hanako, "/api/workspaces/" + this.workspace)).bodyJson()
			.extractingPath("$.mentionCount")
			.isEqualTo(2);
		// 参加していない会話には未読を出さないので、サイドバーには旅行がない
		assertThat(sidebar(this.hanako)).bodyJson().extractingPath(path(travel, "id")).asList().isEmpty();
		// 送った人には未読もメンションもない
		assertThat(workspaces(this.taro)).bodyJson().extractingPath("$[0].hasUnread").isEqualTo(false);
	}

	// TC-14-7（NT-11）
	@Test
	void 抜けたプライベートチャンネルのメンションは数えず一覧にも出さない() {
		long secret = channel("運営", "PRIVATE");
		post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(secret), "{\"usernames\":[\"hanako\"]}");
		send(this.taro, secret, "@hanako 秘密");
		assertThat(workspaces(this.hanako)).bodyJson().extractingPath("$[0].mentionCount").isEqualTo(1);

		assertThat(post(this.mvc, this.hanako, "/api/conversations/%d/leave".formatted(secret), "{}"))
			.hasStatus(HttpStatus.NO_CONTENT);
		assertThat(workspaces(this.hanako)).bodyJson().extractingPath("$[0].mentionCount").isEqualTo(0);
		assertThat(mentions(this.hanako, "")).bodyJson().extractingPath("$.items").asList().isEmpty();
	}

	// TC-14-6（NT-5）
	@Test
	void メンションの一覧は新しい順に20件ずつで_会話と読んだかを返す() throws Exception {
		long dmId = dm(this.jiro, "hanako");
		long first = send(this.taro, this.general, "@hanako 最初");
		long inDm = send(this.jiro, dmId, "@hanako DM で");
		for (int i = 0; i < 20; i++) {
			send(this.taro, this.general, "@hanako " + i);
		}
		read(this.hanako, this.general, first);

		MvcTestResult page = mentions(this.hanako, "");
		assertThat(page).hasStatusOk();
		assertThat(page).bodyJson().extractingPath("$.items").asList().hasSize(20);
		assertThat(page).bodyJson().extractingPath("$.items[0].message.body").isEqualTo("@hanako 19");
		assertThat(page).bodyJson().extractingPath("$.items[0].read").isEqualTo(false);
		assertThat(page).bodyJson().extractingPath("$.items[0].conversation.name").isEqualTo("general");
		String next = JsonPath.read(page.getResponse().getContentAsString(StandardCharsets.UTF_8), "$.nextCursor");

		MvcTestResult rest = mentions(this.hanako, "?cursor=" + next);
		assertThat(rest).bodyJson().extractingPath("$.items[*].message.id").isEqualTo(List.of((int) inDm, (int) first));
		assertThat(rest).bodyJson().extractingPath("$.items[0].conversation.type").isEqualTo("DM");
		assertThat(rest).bodyJson().extractingPath("$.items[0].conversation.dmPartner.username").isEqualTo("jiro");
		assertThat(rest).bodyJson().extractingPath("$.items[1].read").isEqualTo(true);
		assertThat(rest).bodyJson().extractingPath("$.nextCursor").isNull();

		assertError(mentions(this.hanako, "?cursor=abc"), ErrorCode.BAD_REQUEST, "cursor");
		assertThat(mentions(this.jiro, "")).bodyJson().extractingPath("$.items").asList().isEmpty();
	}

	// TC-11-7（MN-6）
	@Test
	void 編集でメンションを消すと件数から消える() {
		long id = send(this.taro, this.general, "@hanako @jiro");
		assertThat(patch(this.mvc, this.taro, "/api/messages/" + id, "{\"body\":\"@jiro\"}")).hasStatusOk();
		assertThat(sidebar(this.hanako)).bodyJson()
			.extractingPath(path(this.general, "mentionCount"))
			.isEqualTo(List.of(0));
		assertThat(sidebar(this.jiro)).bodyJson()
			.extractingPath(path(this.general, "mentionCount"))
			.isEqualTo(List.of(1));
	}

	// MS-1：会話の詳細に最後に読んだメッセージ（「新着」の線の位置）
	@Test
	void 会話の詳細は最後に読んだメッセージを返し_参加していない会話はnull() {
		long first = send(this.taro, this.general, "1");
		send(this.taro, this.general, "2");
		read(this.hanako, this.general, first);
		MvcTestResult detail = get(this.mvc, this.hanako, "/api/conversations/" + this.general);
		assertThat(detail).bodyJson().extractingPath("$.lastReadMessageId").isEqualTo((int) first);
		assertThat(detail).bodyJson().extractingPath("$.unreadCount").isEqualTo(1);

		long travel = channel("旅行", "PUBLIC");
		assertThat(get(this.mvc, this.hanako, "/api/conversations/" + travel)).bodyJson()
			.extractingPath("$.lastReadMessageId")
			.isNull();
	}

	// MS-14（FN-07 6 章）
	@Test
	void aroundはそのメッセージと前後25件ずつを返し_返信なら親の前後() {
		long taroId = userId(this.jdbc, "taro_y");
		IntStream.range(0, 60)
			.forEach((i) -> this.jdbc.update(
					"INSERT INTO messages (conversation_id, user_id, client_id, body) VALUES (?, ?, gen_random_uuid(), ?)",
					this.general, taroId, "m" + i));
		long target = this.jdbc.queryForObject("SELECT id FROM messages WHERE body = 'm30'", Long.class);

		MvcTestResult result = get(this.mvc, this.hanako,
				"/api/conversations/%d/messages?around=%d".formatted(this.general, target));
		assertThat(result).bodyJson().extractingPath("$.items").asList().hasSize(51);
		assertThat(result).bodyJson().extractingPath("$.items[25].id").isEqualTo((int) target);
		assertThat(result).bodyJson().extractingPath("$.items[0].body").isEqualTo("m5");
		assertThat(result).bodyJson().extractingPath("$.hasMoreBefore").isEqualTo(true);
		assertThat(result).bodyJson().extractingPath("$.hasMoreAfter").isEqualTo(true);

		long r = reply(this.jiro, target, "返信");
		assertThat(get(this.mvc, this.hanako, "/api/conversations/%d/messages?around=%d".formatted(this.general, r)))
			.bodyJson()
			.extractingPath("$.items[25].id")
			.isEqualTo((int) target);

		long travel = channel("旅行", "PUBLIC");
		assertError(get(this.mvc, this.hanako, "/api/conversations/%d/messages?around=%d".formatted(travel, target)),
				ErrorCode.MESSAGE_NOT_FOUND);
		assertError(
				get(this.mvc, this.hanako,
						"/api/conversations/%d/messages?around=%d&before=%d".formatted(this.general, target, target)),
				ErrorCode.BAD_REQUEST, "around");
	}

}
