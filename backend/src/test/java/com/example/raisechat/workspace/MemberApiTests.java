package com.example.raisechat.workspace;

import static com.example.raisechat.ApiTestSupport.createWorkspace;
import static com.example.raisechat.ApiTestSupport.delete;
import static com.example.raisechat.ApiTestSupport.get;
import static com.example.raisechat.ApiTestSupport.join;
import static com.example.raisechat.ApiTestSupport.post;
import static com.example.raisechat.ApiTestSupport.put;
import static com.example.raisechat.ApiTestSupport.readLong;
import static com.example.raisechat.ApiTestSupport.signup;
import static com.example.raisechat.ApiTestSupport.userId;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
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

import com.example.raisechat.MutableClock;
import com.example.raisechat.TestcontainersConfiguration;
import com.jayway.jsonpath.JsonPath;

import jakarta.servlet.http.Cookie;

// メンバー管理（機能定義書 FN-05）とワークスペースの削除（FN-03 W-6）を、API を通して確かめる。
// 10 章の「テストの観点」のうち API で確かめるもの（DM は 1-9、メンションは 1-15 で足す）。
// taro_y がオーナー、hanako・jiro がメンバー
@SpringBootTest
@Import({ TestcontainersConfiguration.class, MutableClock.Config.class })
@AutoConfigureMockMvc
class MemberApiTests {

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

	private MvcTestResult members(Cookie user, String query) {
		return get(this.mvc, user, "/api/workspaces/%d/members%s".formatted(this.workspace, query));
	}

	private MvcTestResult kick(Cookie user, String username) {
		return delete(this.mvc, user, "/api/workspaces/%d/members/%s".formatted(this.workspace, username));
	}

	private MvcTestResult leave(Cookie user) {
		return post(this.mvc, user, "/api/workspaces/%d/leave".formatted(this.workspace), "{}");
	}

	private MvcTestResult deleteWorkspace(Cookie user, String confirmName) {
		return delete(this.mvc, user, "/api/workspaces/" + this.workspace,
				"{\"confirmName\":\"%s\"}".formatted(confirmName));
	}

	private long channel(Cookie user, String name, String visibility) {
		MvcTestResult result = post(this.mvc, user, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"%s\",\"visibility\":\"%s\"}".formatted(name, visibility));
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	private long send(Cookie user, long conversationId, String body) {
		MvcTestResult result = post(this.mvc, user, "/api/conversations/%d/messages".formatted(conversationId),
				"{\"body\":\"%s\",\"clientId\":\"%s\"}".formatted(body, UUID.randomUUID()));
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	private void displayName(String username, String displayName) {
		this.jdbc.update("UPDATE users SET display_name = ? WHERE username = ?", displayName, username);
	}

	private int count(String sql, Object... args) {
		Integer n = this.jdbc.queryForObject(sql, Integer.class, args);
		assertThat(n).isNotNull();
		return n;
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

	// ----------------------------------------------------------------
	// 一覧（MB-1、TC-05-1）

	@Test
	void オーナーが先頭で_あとは表示名の順_役割と参加日時と人数を返す() {
		displayName("taro_y", "ん太郎");
		displayName("hanako", "はなこ");
		displayName("jiro", "あじろう");

		MvcTestResult result = members(this.hanako, "");

		assertThat(result).hasStatusOk();
		assertThat(result).bodyJson()
			.extractingPath("$.items[*].username")
			.asArray()
			.containsExactly("taro_y", "jiro", "hanako");
		assertThat(result).bodyJson()
			.extractingPath("$.items[*].role")
			.asArray()
			.containsExactly("OWNER", "MEMBER", "MEMBER");
		assertThat(result).bodyJson().extractingPath("$.items[0].joinedAt").isNotNull();
		assertThat(result).bodyJson().extractingPath("$.memberCount").isEqualTo(3);
		assertThat(result).bodyJson().extractingPath("$.nextCursor").isNull();
	}

	@Test
	void 表示名かユーザーIDに含む人だけに絞り_大文字小文字を区別しない() {
		displayName("hanako", "たろうの妹");

		assertThat(members(this.jiro, "?q=たろ")).bodyJson()
			.extractingPath("$.items[*].username")
			.asArray()
			.containsExactly("hanako");
		assertThat(members(this.jiro, "?q=TARO")).bodyJson()
			.extractingPath("$.items[*].username")
			.asArray()
			.containsExactly("taro_y");
		// 「_」は文字として探す
		assertThat(members(this.jiro, "?q=o_")).bodyJson()
			.extractingPath("$.items[*].username")
			.asArray()
			.containsExactly("taro_y");
		MvcTestResult none = members(this.jiro, "?q=zzz");
		assertThat(none).bodyJson().extractingPath("$.items").asArray().isEmpty();
		// 人数は絞り込まない
		assertThat(none).bodyJson().extractingPath("$.memberCount").isEqualTo(3);
		assertError(members(this.jiro, "?q=" + "a".repeat(31)), HttpStatus.BAD_REQUEST, "BAD_REQUEST");
	}

	@Test
	void 五十人ずつ読み_続きはカーソルで読む() {
		IntStream.range(0, 50).forEach((i) -> {
			String username = "user%02d".formatted(i);
			signup(this.mvc, username);
			join(this.jdbc, this.workspace, username);
		});

		MvcTestResult page1 = members(this.taro, "");
		assertThat(page1).bodyJson().extractingPath("$.items").asArray().hasSize(50);
		assertThat(page1).bodyJson().extractingPath("$.items[0].username").isEqualTo("taro_y");
		String cursor = JsonPath.read(body(page1), "$.nextCursor");
		MvcTestResult page2 = members(this.taro, "?cursor=" + cursor);
		assertThat(page2).bodyJson().extractingPath("$.items").asArray().hasSize(3);
		assertThat(page2).bodyJson().extractingPath("$.nextCursor").isNull();
		assertError(members(this.taro, "?cursor=2:x:y"), HttpStatus.BAD_REQUEST, "BAD_REQUEST");
	}

	@Test
	void メンバーでない人は一覧を見られない() {
		Cookie saburo = signup(this.mvc, "saburo");

		assertError(members(saburo, ""), HttpStatus.NOT_FOUND, "WORKSPACE_NOT_FOUND");
		assertError(get(this.mvc, saburo, "/api/workspaces/%d/members/hanako".formatted(this.workspace)),
				HttpStatus.NOT_FOUND, "WORKSPACE_NOT_FOUND");
	}

	@Test
	void 一人のメンバーを返し_いなければ404() {
		assertThat(get(this.mvc, this.jiro, "/api/workspaces/%d/members/HANAKO".formatted(this.workspace))).bodyJson()
			.isLenientlyEqualTo("{\"username\":\"hanako\",\"displayName\":\"hanakoの名前\",\"role\":\"MEMBER\"}");
		signup(this.mvc, "saburo");
		assertError(get(this.mvc, this.jiro, "/api/workspaces/%d/members/saburo".formatted(this.workspace)),
				HttpStatus.NOT_FOUND, "USER_NOT_FOUND");
		assertError(get(this.mvc, this.jiro, "/api/workspaces/%d/members/nobody".formatted(this.workspace)),
				HttpStatus.NOT_FOUND, "USER_NOT_FOUND");
	}

	// ----------------------------------------------------------------
	// キック（MB-3・MB-4、TC-05-2・TC-05-3・TC-05-4）

	// BR-9
	@Test
	void キックするとワークスペースとチャンネルから外れ_会話を読めなくなり_メッセージは残る() {
		long chat = channel(this.taro, "雑談", "PUBLIC");
		long secret = channel(this.taro, "運営", "PRIVATE");
		post(this.mvc, this.hanako, "/api/conversations/%d/join".formatted(chat), "{}");
		post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(secret), "{\"usernames\":[\"hanako\"]}");
		long message = send(this.hanako, this.general, "こんにちは");

		assertThat(kick(this.taro, "hanako")).hasStatus(HttpStatus.NO_CONTENT);

		long hanakoId = userId(this.jdbc, "hanako");
		assertThat(count("SELECT count(*) FROM workspace_members WHERE user_id = ?", hanakoId)).isZero();
		assertThat(count("SELECT count(*) FROM conversation_members WHERE user_id = ?", hanakoId)).isZero();
		assertThat(get(this.mvc, this.hanako, "/api/workspaces")).bodyJson().extractingPath("$").asArray().isEmpty();
		for (long conversation : new long[] { this.general, chat, secret }) {
			assertError(get(this.mvc, this.hanako, "/api/conversations/%d/messages".formatted(conversation)),
					HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND");
		}
		assertError(members(this.hanako, ""), HttpStatus.NOT_FOUND, "WORKSPACE_NOT_FOUND");
		// 送ったメッセージは残る（MB-6）
		assertThat(get(this.mvc, this.jiro, "/api/conversations/%d/messages".formatted(this.general))).bodyJson()
			.extractingPath("$.items[*].id")
			.asArray()
			.contains((int) message);
		assertThat(members(this.taro, "")).bodyJson().extractingPath("$.memberCount").isEqualTo(2);
	}

	// BR-9
	@Test
	void キックで_DMの行は残す() {
		long taroId = userId(this.jdbc, "taro_y");
		long hanakoId = userId(this.jdbc, "hanako");
		Long dm = this.jdbc.queryForObject(
				"INSERT INTO conversations (workspace_id, type, dm_user_low, dm_user_high, "
						+ "created_by) VALUES (?, 'DM', ?, ?, ?) RETURNING id",
				Long.class, this.workspace, Math.min(taroId, hanakoId), Math.max(taroId, hanakoId), taroId);
		this.jdbc.update("INSERT INTO conversation_members (conversation_id, user_id, last_read_message_id) "
				+ "VALUES (?, ?, 0), (?, ?, 0)", dm, taroId, dm, hanakoId);

		assertThat(kick(this.taro, "hanako")).hasStatus(HttpStatus.NO_CONTENT);

		assertThat(count("SELECT count(*) FROM conversation_members WHERE conversation_id = ?", dm)).isEqualTo(2);
	}

	// BR-3
	@Test
	void オーナーでない人はキックできず_オーナーはキックできない() {
		assertError(kick(this.hanako, "jiro"), HttpStatus.FORBIDDEN, "NOT_OWNER");
		assertError(kick(this.hanako, "taro_y"), HttpStatus.FORBIDDEN, "NOT_OWNER");
		assertError(kick(this.taro, "taro_y"), HttpStatus.FORBIDDEN, "CANNOT_KICK_OWNER");
		signup(this.mvc, "saburo");
		assertError(kick(this.taro, "saburo"), HttpStatus.NOT_FOUND, "USER_NOT_FOUND");
		assertThat(kick(this.taro, "jiro")).hasStatus(HttpStatus.NO_CONTENT);
		// もういない人をもう一度キックすると 404（画面は一覧を読み直す）
		assertError(kick(this.taro, "jiro"), HttpStatus.NOT_FOUND, "USER_NOT_FOUND");
	}

	// ----------------------------------------------------------------
	// 退出（MB-5、TC-05-6）

	// BR-9
	@Test
	void 退出するとワークスペースとチャンネルから外れ_一覧から消える() {
		long chat = channel(this.taro, "雑談", "PUBLIC");
		post(this.mvc, this.jiro, "/api/conversations/%d/join".formatted(chat), "{}");

		assertThat(leave(this.jiro)).hasStatus(HttpStatus.NO_CONTENT);

		assertThat(get(this.mvc, this.jiro, "/api/workspaces")).bodyJson().extractingPath("$").asArray().isEmpty();
		assertThat(count("SELECT count(*) FROM conversation_members WHERE user_id = ?", userId(this.jdbc, "jiro")))
			.isZero();
		assertError(leave(this.jiro), HttpStatus.NOT_FOUND, "WORKSPACE_NOT_FOUND");
	}

	@Test
	void オーナーは退出できない() {
		assertError(leave(this.taro), HttpStatus.FORBIDDEN, "OWNER_CANNOT_LEAVE");
	}

	// ----------------------------------------------------------------
	// また参加したとき（MB-7、TC-05-7）

	@Test
	void 退出した人が招待リンクでまた参加すると_generalにだけ入り直し_プライベートチャンネルは見られない() {
		long secret = channel(this.taro, "運営", "PRIVATE");
		post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(secret), "{\"usernames\":[\"jiro\"]}");
		assertThat(leave(this.jiro)).hasStatus(HttpStatus.NO_CONTENT);
		String url = JsonPath.read(
				body(post(this.mvc, this.taro, "/api/workspaces/%d/invites".formatted(this.workspace), "{}")), "$.url");

		assertThat(post(this.mvc, this.jiro,
				"/api/invites/%s/accept".formatted(url.substring(url.lastIndexOf('/') + 1)), "{}"))
			.hasStatusOk();

		assertThat(get(this.mvc, this.jiro, "/api/workspaces/%d/conversations".formatted(this.workspace))).bodyJson()
			.extractingPath("$[*].name")
			.asArray()
			.containsExactly("general");
		assertError(get(this.mvc, this.jiro, "/api/conversations/%d/messages".formatted(secret)), HttpStatus.NOT_FOUND,
				"CONVERSATION_NOT_FOUND");
	}

	// ----------------------------------------------------------------
	// ワークスペースの削除（W-6）

	// TC-03-9（添付の S3 のファイルは AttachmentApiTests）
	@Test
	void オーナーが名前を入れて削除すると_中のデータごと消え_誰の一覧からも消える() {
		long chat = channel(this.taro, "雑談", "PUBLIC");
		long message = send(this.taro, chat, "@hanako こんにちは");
		assertThat(put(this.mvc, this.taro, "/api/messages/%d/reactions/%s".formatted(message, "👍")))
			.hasStatus2xxSuccessful();
		long dm = readLong(post(this.mvc, this.hanako, "/api/workspaces/%d/dms".formatted(this.workspace),
				"{\"username\":\"jiro\"}"), "$.id");
		send(this.hanako, dm, "DM です");
		String url = JsonPath.read(
				body(post(this.mvc, this.taro, "/api/workspaces/%d/invites".formatted(this.workspace), "{}")), "$.url");
		assertThat(count("SELECT count(*) FROM reactions")).isOne();
		assertThat(count("SELECT count(*) FROM mentions")).isOne();

		assertThat(deleteWorkspace(this.taro, "仲間うち")).hasStatus(HttpStatus.NO_CONTENT);

		assertThat(count("SELECT count(*) FROM workspaces")).isZero();
		for (String table : new String[] { "workspace_members", "conversations", "conversation_members", "messages",
				"reactions", "mentions", "invites" }) {
			assertThat(count("SELECT count(*) FROM " + table)).as(table).isZero();
		}
		// その招待リンクはもう使えない（M-18）
		assertError(get(this.mvc, this.jiro, "/api/invites/" + url.substring(url.lastIndexOf('/') + 1)),
				HttpStatus.GONE, "INVITE_INVALID");
		assertThat(get(this.mvc, this.hanako, "/api/workspaces")).bodyJson().extractingPath("$").asArray().isEmpty();
		assertError(get(this.mvc, this.taro, "/api/workspaces/" + this.workspace), HttpStatus.NOT_FOUND,
				"WORKSPACE_NOT_FOUND");
		// 作れる数（10 個）にも数えない
		assertThat(createWorkspace(this.mvc, this.taro, "仲間うち")).hasStatus(HttpStatus.CREATED);
	}

	// TC-03-7・TC-03-8、BR-3
	@Test
	void 名前が違えば400_オーナーでなければ403_メンバーでなければ404() {
		assertError(deleteWorkspace(this.taro, "仲間"), HttpStatus.BAD_REQUEST, "CONFIRM_NAME_MISMATCH");
		assertError(deleteWorkspace(this.taro, "仲間うち "), HttpStatus.BAD_REQUEST, "CONFIRM_NAME_MISMATCH");
		assertError(deleteWorkspace(this.hanako, "仲間うち"), HttpStatus.FORBIDDEN, "NOT_OWNER");
		assertError(deleteWorkspace(signup(this.mvc, "saburo"), "仲間うち"), HttpStatus.NOT_FOUND, "WORKSPACE_NOT_FOUND");
		assertThat(count("SELECT count(*) FROM workspaces")).isEqualTo(1);
	}

}
