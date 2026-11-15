package com.example.raisechat.mention;

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

import java.util.List;
import java.util.UUID;

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

import jakarta.servlet.http.Cookie;

// メンション（機能定義書 FN-11）を、API を通して確かめる。10 章の「テストの観点」のうち記録と候補
// （通知は 1-15）。taro_y がオーナー、hanako・jiro がメンバー
@SpringBootTest
@Import(TestcontainersConfiguration.class)
@AutoConfigureMockMvc
class MentionApiTests {

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

	private MvcTestResult send(Cookie user, long conversationId, String body) {
		MvcTestResult result = post(this.mvc, user, "/api/conversations/%d/messages".formatted(conversationId),
				"{\"body\":\"%s\",\"clientId\":\"%s\"}".formatted(body, UUID.randomUUID()));
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return result;
	}

	private long channel(String name, String visibility) {
		MvcTestResult result = post(this.mvc, this.taro, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"%s\",\"visibility\":\"%s\"}".formatted(name, visibility));
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	private List<String> mentioned(long messageId) {
		return this.jdbc.queryForList("""
				SELECT u.username FROM mentions m JOIN users u ON u.id = m.user_id
				WHERE m.message_id = ? ORDER BY u.username""", String.class, messageId);
	}

	private MvcTestResult candidates(Cookie user, long conversationId, String q) {
		return get(this.mvc, user, "/api/conversations/%d/mention-candidates?q=%s".formatted(conversationId, q));
	}

	// TC-11-4・TC-11-5（MN-2・MN-4、5 章の 1）
	@Test
	void 本文のメンションを記録し_自分といない人と2つ目以降は記録しない() {
		MvcTestResult sent = send(this.taro, this.general,
				"@HANAKO と @jiro、@taro_y と @nobody、もう一度 @hanako。a@jiro と `@jiro`");
		long id = readLong(sent, "$.id");

		assertThat(mentioned(id)).containsExactly("hanako", "jiro");
		// 画面はこの人の「@ユーザー ID」だけを目立たせる（5 章の 5）
		assertThat(sent).bodyJson()
			.extractingPath("$.mentions[*].username")
			.asList()
			.containsExactlyInAnyOrder("hanako", "jiro");
		assertThat(sent).bodyJson().extractingPath("$.mentions[0].displayName").isEqualTo("hanakoの名前");
		// 本文の文字は消さない
		assertThat(sent).bodyJson().extractingPath("$.body").asString().contains("@nobody");
		assertThat(get(this.mvc, this.jiro, "/api/conversations/%d/messages".formatted(this.general))).bodyJson()
			.extractingPath("$.items[0].mentions")
			.asList()
			.hasSize(2);
	}

	// TC-11-3（5 章の 2）
	@Test
	void 公開チャンネルではチャンネルにいないワークスペースのメンバーも記録する() {
		long travel = channel("旅行", "PUBLIC");
		long id = readLong(send(this.taro, travel, "@hanako 行く？"), "$.id");
		assertThat(mentioned(id)).containsExactly("hanako");
	}

	// TC-11-2・TC-11-9（5 章の 2・3）
	@Test
	void プライベートチャンネルではメンバーでない人を記録せず_後から招待しても出ない() {
		long secret = channel("運営", "PRIVATE");
		long id = readLong(send(this.taro, secret, "@hanako 見える？"), "$.id");
		assertThat(mentioned(id)).isEmpty();

		assertThat(post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(secret),
				"{\"usernames\":[\"hanako\"]}"))
			.hasStatusOk();
		assertThat(get(this.mvc, this.hanako, "/api/messages/" + id)).bodyJson()
			.extractingPath("$.mentions")
			.asList()
			.isEmpty();
	}

	// TC-11-2（DM は 2 人だけ）
	@Test
	void DMでは相手のほかは記録しない() {
		MvcTestResult started = post(this.mvc, this.hanako, "/api/workspaces/%d/dms".formatted(this.workspace),
				"{\"username\":\"jiro\"}");
		long dm = readLong(started, "$.id");
		long id = readLong(send(this.hanako, dm, "@jiro と @taro_y"), "$.id");
		assertThat(mentioned(id)).containsExactly("jiro");
	}

	@Test
	void キックされた人は記録しない() {
		assertThat(delete(this.mvc, this.taro, "/api/workspaces/%d/members/jiro".formatted(this.workspace)))
			.hasStatus(HttpStatus.NO_CONTENT);
		long id = readLong(send(this.taro, this.general, "@jiro @hanako"), "$.id");
		assertThat(mentioned(id)).containsExactly("hanako");
	}

	// TC-11-8
	@Test
	void スレッドの返信のメンションも記録する() {
		long parent = readLong(send(this.taro, this.general, "親"), "$.id");
		MvcTestResult replied = post(this.mvc, this.hanako, "/api/messages/%d/replies".formatted(parent),
				"{\"body\":\"@jiro どう？\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID()));
		assertThat(replied).hasStatus(HttpStatus.CREATED);
		assertThat(mentioned(readLong(replied, "$.id"))).containsExactly("jiro");
	}

	// TC-11-7（MN-6、5 章の 4）
	@Test
	void 編集で増えた人を足し減った人を消し_残った人の読んだかは変えない() {
		long id = readLong(send(this.taro, this.general, "@hanako @jiro"), "$.id");
		this.jdbc.update("UPDATE mentions SET is_read = true WHERE user_id = ?", userId(this.jdbc, "hanako"));
		signup(this.mvc, "saburo");
		join(this.jdbc, this.workspace, "saburo");

		MvcTestResult edited = patch(this.mvc, this.taro, "/api/messages/" + id, "{\"body\":\"@hanako @saburo\"}");
		assertThat(edited).hasStatusOk();

		assertThat(mentioned(id)).containsExactly("hanako", "saburo");
		assertThat(this.jdbc.queryForObject("SELECT is_read FROM mentions WHERE message_id = ? AND user_id = ?",
				Boolean.class, id, userId(this.jdbc, "hanako")))
			.isTrue();
		assertThat(edited).bodyJson()
			.extractingPath("$.mentions[*].username")
			.asList()
			.containsExactlyInAnyOrder("hanako", "saburo");
	}

	// BR-8
	@Test
	void 削除されましたにするとメンションも消え_データごと消しても消える() {
		long parent = readLong(send(this.taro, this.general, "@hanako 親"), "$.id");
		post(this.mvc, this.jiro, "/api/messages/%d/replies".formatted(parent),
				"{\"body\":\"返信\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID()));
		long other = readLong(send(this.taro, this.general, "@jiro 消すもの"), "$.id");

		MvcTestResult deleted = delete(this.mvc, this.taro, "/api/messages/" + parent);
		assertThat(deleted).hasStatusOk();
		assertThat(deleted).bodyJson().extractingPath("$.mentions").asList().isEmpty();
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + other)).hasStatus(HttpStatus.NO_CONTENT);
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM mentions", Integer.class)).isZero();
	}

	// TC-11-1（MN-1）
	@Test
	void 候補は見られる人のうち会話のメンバーを先に表示名の順に8人まで_自分は出ない() {
		long travel = channel("旅行", "PUBLIC");
		for (int i = 1; i <= 8; i++) {
			signup(this.mvc, "user" + i);
			join(this.jdbc, this.workspace, "user" + i);
		}
		// jiro だけが旅行に参加している
		assertThat(post(this.mvc, this.jiro, "/api/conversations/%d/join".formatted(travel), "{}")).hasStatusOk();

		MvcTestResult result = candidates(this.taro, travel, "");
		assertThat(result).hasStatusOk();
		assertThat(result).bodyJson().extractingPath("$").asList().hasSize(8);
		assertThat(result).bodyJson().extractingPath("$[0].user.username").isEqualTo("jiro");
		assertThat(result).bodyJson().extractingPath("$[0].member").isEqualTo(true);
		assertThat(result).bodyJson().extractingPath("$[1].member").isEqualTo(false);
		assertThat(result).bodyJson().extractingPath("$[*].user.username").asList().doesNotContain("taro_y");

		// 表示名・ユーザー ID のどちらでも探せる。「_」はワイルドカードにしない
		assertThat(candidates(this.taro, travel, "HANA")).bodyJson()
			.extractingPath("$[*].user.username")
			.isEqualTo(List.of("hanako"));
		assertThat(candidates(this.taro, travel, "o_")).bodyJson().extractingPath("$").asList().isEmpty();
	}

	// TC-11-2
	@Test
	void プライベートチャンネルの候補はメンバーだけで_見られない会話は404() {
		long secret = channel("運営", "PRIVATE");
		assertThat(candidates(this.taro, secret, "")).bodyJson().extractingPath("$").asList().isEmpty();
		assertError(candidates(this.hanako, secret, ""), ErrorCode.CONVERSATION_NOT_FOUND);
		assertError(candidates(this.taro, this.general, "a".repeat(31)), ErrorCode.BAD_REQUEST, "q");
	}

}
