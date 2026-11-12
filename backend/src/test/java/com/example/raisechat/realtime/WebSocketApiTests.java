package com.example.raisechat.realtime;

import static com.example.raisechat.ApiTestSupport.createWorkspace;
import static com.example.raisechat.ApiTestSupport.delete;
import static com.example.raisechat.ApiTestSupport.join;
import static com.example.raisechat.ApiTestSupport.patch;
import static com.example.raisechat.ApiTestSupport.post;
import static com.example.raisechat.ApiTestSupport.readLong;
import static com.example.raisechat.ApiTestSupport.signup;
import static com.example.raisechat.ApiTestSupport.userId;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

import com.example.raisechat.MutableClock;
import com.example.raisechat.TestcontainersConfiguration;

import jakarta.servlet.http.Cookie;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;

// リアルタイムの通知（機能定義書 4 章、FN-07）を、本物の WebSocket でつないで確かめる。
// つなぐ条件（ログイン・Origin）、購読の権限（TC-07-15）、通知の中身、JWT の期限で切ること、購読の取り消し（4.5）。
// 送った通知の JSON は docs/api/realtime-events.json に書き出し、画面のテストが読めるかを確かめる（基本設計書 2.1）
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import({ TestcontainersConfiguration.class, MutableClock.Config.class })
@AutoConfigureMockMvc
class WebSocketApiTests {

	// mvnw は backend で実行するので、リポジトリの直下は 1 つ上
	private static final Path SAMPLES = Path.of("..", "docs", "api", "realtime-events.json");

	private static final String ORIGIN = "http://localhost:5173";

	private static final JsonMapper JSON = JsonMapper.builder().enable(SerializationFeature.INDENT_OUTPUT).build();

	@LocalServerPort
	int port;

	@Autowired
	MockMvcTester mvc;

	@Autowired
	JdbcTemplate jdbc;

	@Autowired
	MutableClock clock;

	@Autowired
	SimpUserRegistry registry;

	@Autowired
	SubscriptionRevoker revoker;

	@Autowired
	RealtimeNotifier notifier;

	private final List<StompTestClient> clients = new ArrayList<>();

	private Cookie taro;

	private Cookie hanako;

	private long workspace;

	private long general;

	@BeforeEach
	void setUp() {
		// 通知の見本を毎回同じ中身にするため、時刻を決めておく
		this.clock.set(Instant.parse("2026-11-10T01:02:00Z"));
		this.jdbc.execute("TRUNCATE users, refresh_tokens, workspaces RESTART IDENTITY CASCADE");
		this.taro = signup(this.mvc, "taro_y");
		this.hanako = signup(this.mvc, "hanako");
		MvcTestResult created = createWorkspace(this.mvc, this.taro, "仲間うち");
		this.workspace = readLong(created, "$.id");
		this.general = readLong(created, "$.generalConversationId");
		join(this.jdbc, this.workspace, "hanako");
	}

	@AfterEach
	void tearDown() {
		this.clients.forEach(StompTestClient::close);
		this.clock.reset();
	}

	private StompTestClient connect(Cookie user) throws Exception {
		StompTestClient client = StompTestClient.connect(this.port, user, ORIGIN);
		this.clients.add(client);
		return client;
	}

	private String topic(long conversationId) {
		return "/topic/conversations/" + conversationId;
	}

	// 購読はサーバーで非同期に登録されるので、登録されるまで待つ
	private void awaitSubscribers(String destination, int count) {
		await().atMost(Duration.ofSeconds(5))
			.until(() -> this.registry.findSubscriptions((s) -> destination.equals(s.getDestination())).size(),
					(n) -> n == count);
	}

	private long send(Cookie user, String body) {
		MvcTestResult result = post(this.mvc, user, "/api/conversations/%d/messages".formatted(this.general),
				"{\"body\":\"%s\",\"clientId\":\"%s\"}".formatted(body, UUID.randomUUID()));
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	// ---------------------------------------------------------------- つなぐ条件（4.1）

	@Test
	void ログインしていなければつながらない() {
		assertThatThrownBy(() -> StompTestClient.connect(this.port, null, ORIGIN)).hasStackTraceContaining("401");
	}

	@Test
	void Originがほかのサイトならつながらない() {
		assertThatThrownBy(() -> StompTestClient.connect(this.port, this.taro, "https://evil.example"))
			.hasStackTraceContaining("403");
	}

	@Test
	void Originが画面のURLならつながる() throws Exception {
		assertThat(connect(this.taro).isConnected()).isTrue();
	}

	@Test
	void JWTの期限が来たら理由をつけて切る() throws Exception {
		// JWT の期限（15 分）の 1 秒前につなぐと、1 秒後に切れる
		this.clock.advance(Duration.ofMinutes(15).minusSeconds(1));
		StompTestClient client = connect(this.taro);

		assertThat(client.closeStatus().getCode()).isEqualTo(WebSocketSessions.TOKEN_EXPIRED.getCode());
	}

	@Test
	void 期限の切れたJWTではつながらない() {
		this.clock.advance(Duration.ofMinutes(15));

		assertThatThrownBy(() -> StompTestClient.connect(this.port, this.taro, ORIGIN)).hasStackTraceContaining("401");
	}

	// ----------------------------------------------------------------
	// 購読の権限（4.2、TC-07-15）

	@Test
	void ほかのワークスペースの会話は購読できない() throws Exception {
		long other = readLong(createWorkspace(this.mvc, this.hanako, "別の集まり"), "$.generalConversationId");
		StompTestClient client = connect(this.taro);

		client.subscribe(topic(other));

		assertThat(client.error()).isNotNull();
		assertThat(client.closeStatus()).isNotNull();
		assertThat(this.registry.findSubscriptions((s) -> topic(other).equals(s.getDestination()))).isEmpty();
	}

	@Test
	void 入っていないプライベートチャンネルは購読できない() throws Exception {
		long privateChannel = privateChannel();
		StompTestClient client = connect(this.hanako);

		client.subscribe(topic(privateChannel));

		assertThat(client.error()).isNotNull();
	}

	@Test
	void ない会話と数字でない宛先は購読できない() throws Exception {
		StompTestClient missing = connect(this.taro);
		missing.subscribe(topic(9999));
		assertThat(missing.error()).isNotNull();

		StompTestClient notNumber = connect(this.taro);
		notNumber.subscribe("/topic/conversations/abc");
		assertThat(notNumber.error()).isNotNull();
	}

	@Test
	void 決めた宛先のほかは購読できない() throws Exception {
		StompTestClient client = connect(this.taro);

		client.subscribe("/topic/anything");

		assertThat(client.error()).isNotNull();
	}

	@Test
	void 画面からのSENDは受け付けない() throws Exception {
		StompTestClient client = connect(this.taro);

		client.send(topic(this.general), "{}");

		assertThat(client.error()).isNotNull();
	}

	// チャンネルの作成（1-6）はまだないので SQL で作る。taro だけが入っている
	private long privateChannel() {
		Long id = this.jdbc.queryForObject(
				"INSERT INTO conversations (workspace_id, type, name, visibility, is_general, created_by) "
						+ "VALUES (?, 'CHANNEL', '運営', 'PRIVATE', false, ?) RETURNING id",
				Long.class, this.workspace, userId(this.jdbc, "taro_y"));
		assertThat(id).isNotNull();
		this.jdbc.update("INSERT INTO conversation_members (conversation_id, user_id, last_read_message_id) "
				+ "VALUES (?, ?, 0)", id, userId(this.jdbc, "taro_y"));
		return id;
	}

	// ---------------------------------------------------------------- メッセージの通知（FN-07 6
	// 章、TC-07-3）

	@Test
	void 送信_編集_削除が会話を購読している人に届き_JSONの見本を書き出す() throws Exception {
		StompTestClient hanakoClient = connect(this.hanako);
		StompTestClient taroClient = connect(this.taro);
		hanakoClient.subscribe(topic(this.general));
		hanakoClient.subscribe(WebSocketSecurityConfig.USER_EVENTS);
		taroClient.subscribe(topic(this.general));
		awaitSubscribers(topic(this.general), 2);
		awaitSubscribers(WebSocketSecurityConfig.USER_EVENTS, 1);

		long id = send(this.taro, "土曜の集合は駅前で");
		String created = hanakoClient.next();
		this.clock.advance(Duration.ofMinutes(1));
		assertThat(patch(this.mvc, this.taro, "/api/messages/" + id, "{\"body\":\"土曜の集合は駅の北口で\"}")).hasStatusOk();
		String updated = hanakoClient.next();
		assertThat(delete(this.mvc, this.taro, "/api/messages/" + id)).hasStatus(HttpStatus.NO_CONTENT);
		String deleted = hanakoClient.next();

		JsonNode createdJson = JSON.readTree(created);
		assertThat(createdJson.path("type").asString()).isEqualTo("message.created");
		assertThat(createdJson.path("workspaceId").asLong()).isEqualTo(this.workspace);
		assertThat(createdJson.path("conversationId").asLong()).isEqualTo(this.general);
		assertThat(createdJson.path("payload").path("id").asLong()).isEqualTo(id);
		assertThat(createdJson.path("payload").path("body").asString()).isEqualTo("土曜の集合は駅前で");
		assertThat(createdJson.path("payload").path("author").path("username").asString()).isEqualTo("taro_y");
		// 見る人によって変わるものは false で送り、受け取った画面で直す（4.3）
		assertThat(createdJson.path("payload").path("mine").asBoolean()).isFalse();
		assertThat(createdJson.path("payload").path("canDelete").asBoolean()).isFalse();
		assertThat(createdJson.path("sentAt").asString()).isEqualTo("2026-11-10T01:02:00Z");

		JsonNode updatedJson = JSON.readTree(updated);
		assertThat(updatedJson.path("type").asString()).isEqualTo("message.updated");
		assertThat(updatedJson.path("payload").path("body").asString()).isEqualTo("土曜の集合は駅の北口で");
		assertThat(updatedJson.path("payload").path("editedAt").asString()).isEqualTo("2026-11-10T01:03:00Z");

		JsonNode deletedJson = JSON.readTree(deleted);
		assertThat(deletedJson.path("type").asString()).isEqualTo("message.deleted");
		assertThat(deletedJson.path("payload").path("id").asLong()).isEqualTo(id);
		assertThat(deletedJson.path("payload").path("parentId").isNull()).isTrue();

		// 自分の操作の通知も、自分の画面に届く（4.3）
		assertThat(taroClient.next()).isEqualTo(created);

		// 招待されると本人に conversation.updated、退出すると conversation.removed（FN-06）
		long secret = createChannel(this.taro, "運営", "PRIVATE");
		assertThat(post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(secret),
				"{\"usernames\":[\"hanako\"]}"))
			.hasStatusOk();
		JsonNode joinedJson = JSON.readTree(hanakoClient.next());
		assertThat(joinedJson.path("type").asString()).isEqualTo("conversation.updated");
		assertThat(joinedJson.path("conversationId").asLong()).isEqualTo(secret);
		assertThat(joinedJson.path("payload").path("name").asString()).isEqualTo("運営");
		assertThat(joinedJson.path("payload").path("joined").asBoolean()).isTrue();
		assertThat(post(this.mvc, this.hanako, "/api/conversations/%d/leave".formatted(secret), "{}"))
			.hasStatus(HttpStatus.NO_CONTENT);
		JsonNode removedJson = JSON.readTree(hanakoClient.next());
		assertThat(removedJson.path("type").asString()).isEqualTo("conversation.removed");
		assertThat(removedJson.path("payload").path("conversationId").asLong()).isEqualTo(secret);
		assertThat(removedJson.path("payload").path("reason").asString()).isEqualTo("LEFT");

		writeSamples(List.of(createdJson, updatedJson, deletedJson, joinedJson, removedJson));
	}

	private long createChannel(Cookie user, String name, String visibility) {
		MvcTestResult result = post(this.mvc, user, "/api/workspaces/%d/channels".formatted(this.workspace),
				"{\"name\":\"%s\",\"visibility\":\"%s\"}".formatted(name, visibility));
		assertThat(result).hasStatus(HttpStatus.CREATED);
		return readLong(result, "$.id");
	}

	// ----------------------------------------------------------------
	// 見られなくなったとき（FN-06、機能定義書 4.5）

	@Test
	void プライベートチャンネルから退出すると購読が取り消され_通知が届かなくなる() throws Exception {
		long secret = createChannel(this.taro, "運営", "PRIVATE");
		post(this.mvc, this.taro, "/api/conversations/%d/members".formatted(secret), "{\"usernames\":[\"hanako\"]}");
		StompTestClient client = connect(this.hanako);
		client.subscribe(topic(secret));
		awaitSubscribers(topic(secret), 1);

		assertThat(post(this.mvc, this.hanako, "/api/conversations/%d/leave".formatted(secret), "{}"))
			.hasStatus(HttpStatus.NO_CONTENT);
		awaitSubscribers(topic(secret), 0);
		assertThat(post(this.mvc, this.taro, "/api/conversations/%d/messages".formatted(secret),
				"{\"body\":\"抜けた後\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID())))
			.hasStatus(HttpStatus.CREATED);

		assertThat(client.nothingWithin(500)).isTrue();
		assertThat(client.isConnected()).isTrue();
	}

	@Test
	void 公開チャンネルを削除すると_参加していない人にも届き購読が取り消される() throws Exception {
		long chat = createChannel(this.taro, "雑談", "PUBLIC");
		StompTestClient client = connect(this.hanako);
		client.subscribe(WebSocketSecurityConfig.USER_EVENTS);
		client.subscribe(topic(chat));
		awaitSubscribers(WebSocketSecurityConfig.USER_EVENTS, 1);
		awaitSubscribers(topic(chat), 1);

		assertThat(delete(this.mvc, this.taro, "/api/conversations/" + chat)).hasStatus(HttpStatus.NO_CONTENT);

		JsonNode removed = JSON.readTree(client.next());
		assertThat(removed.path("type").asString()).isEqualTo("conversation.removed");
		assertThat(removed.path("payload").path("reason").asString()).isEqualTo("DELETED");
		awaitSubscribers(topic(chat), 0);
	}

	@Test
	void 返信のある親メッセージを削除するとmessage_updatedでdeletedが届く() throws Exception {
		long parent = send(this.taro, "親");
		// スレッド（1-12）はまだないので、返信があることにする
		this.jdbc.update("UPDATE messages SET reply_count = 1 WHERE id = ?", parent);
		StompTestClient client = connect(this.hanako);
		client.subscribe(topic(this.general));
		awaitSubscribers(topic(this.general), 1);

		assertThat(delete(this.mvc, this.taro, "/api/messages/" + parent)).hasStatusOk();

		JsonNode event = JSON.readTree(client.next());
		assertThat(event.path("type").asString()).isEqualTo("message.updated");
		assertThat(event.path("payload").path("deleted").asBoolean()).isTrue();
		assertThat(event.path("payload").path("body").asString()).isEmpty();
	}

	@Test
	void ほかの会話の通知は届かない() throws Exception {
		long privateChannel = privateChannel();
		StompTestClient client = connect(this.hanako);
		client.subscribe(topic(this.general));
		awaitSubscribers(topic(this.general), 1);

		assertThat(post(this.mvc, this.taro, "/api/conversations/%d/messages".formatted(privateChannel),
				"{\"body\":\"内緒\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID())))
			.hasStatus(HttpStatus.CREATED);

		assertThat(client.nothingWithin(500)).isTrue();
	}

	@Test
	void 送れなかったメッセージの通知は送らない() throws Exception {
		StompTestClient client = connect(this.hanako);
		client.subscribe(topic(this.general));
		awaitSubscribers(topic(this.general), 1);

		assertThat(post(this.mvc, this.taro, "/api/conversations/%d/messages".formatted(this.general),
				"{\"body\":\"   \",\"clientId\":\"%s\"}".formatted(UUID.randomUUID())))
			.hasStatus(HttpStatus.BAD_REQUEST);

		assertThat(client.nothingWithin(500)).isTrue();
	}

	// ---------------------------------------------------------------- 本人あての通知（4.2）

	@Test
	void 本人あての通知は本人にだけ届く() throws Exception {
		StompTestClient taroClient = connect(this.taro);
		StompTestClient hanakoClient = connect(this.hanako);
		taroClient.subscribe(WebSocketSecurityConfig.USER_EVENTS);
		hanakoClient.subscribe(WebSocketSecurityConfig.USER_EVENTS);
		awaitSubscribers(WebSocketSecurityConfig.USER_EVENTS, 2);

		this.notifier.toUser(userId(this.jdbc, "taro_y"), RealtimeEvent.Type.MESSAGE_CREATED, this.workspace,
				this.general, new RealtimeEvent.MessageDeleted(1, null));

		assertThat(JSON.readTree(taroClient.next()).path("workspaceId").asLong()).isEqualTo(this.workspace);
		assertThat(hanakoClient.nothingWithin(500)).isTrue();
	}

	// ---------------------------------------------------------------- 購読の取り消し（4.5）

	@Test
	void 購読を取り消すとその会話の通知が届かなくなり_接続は続く() throws Exception {
		StompTestClient client = connect(this.hanako);
		client.subscribe(topic(this.general));
		client.subscribe(WebSocketSecurityConfig.USER_EVENTS);
		awaitSubscribers(topic(this.general), 1);
		awaitSubscribers(WebSocketSecurityConfig.USER_EVENTS, 1);

		this.revoker.revoke(userId(this.jdbc, "hanako"), this.general);
		awaitSubscribers(topic(this.general), 0);
		send(this.taro, "抜けた後");

		assertThat(client.nothingWithin(500)).isTrue();
		assertThat(client.isConnected()).isTrue();
		this.notifier.toUser(userId(this.jdbc, "hanako"), RealtimeEvent.Type.MESSAGE_DELETED, this.workspace,
				this.general, new RealtimeEvent.MessageDeleted(1, null));
		assertThat(client.next()).isNotNull();
	}

	// ---------------------------------------------------------------- 通知の見本

	// コミットしたファイルと違えば、書き直したうえで失敗させる（OpenApiExportTests と同じ）。
	// 手元で失敗したら、書き直された realtime-events.json を確かめてコミットする（画面のテストもこれを読む）
	private static void writeSamples(List<JsonNode> events) throws IOException {
		// 改行は OS によらず LF にそろえる（整形の改行は Windows では CRLF になるため）
		String samples = JSON.writeValueAsString(events).replace("\r\n", "\n") + "\n";
		String committed = Files.exists(SAMPLES)
				? Files.readString(SAMPLES, StandardCharsets.UTF_8).replace("\r\n", "\n") : "";
		if (!samples.equals(committed)) {
			Files.createDirectories(SAMPLES.getParent());
			Files.writeString(SAMPLES, samples, StandardCharsets.UTF_8);
		}
		assertThat(committed).as("通知の形が変わったので docs/api/realtime-events.json を書き直しました。中身を確かめてコミットしてください")
			.isEqualTo(samples);
	}

}
