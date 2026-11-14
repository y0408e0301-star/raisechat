package com.example.raisechat.attachment;

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

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

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
import org.testcontainers.containers.MinIOContainer;

import com.example.raisechat.MutableClock;
import com.example.raisechat.TestcontainersConfiguration;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.storage.TestImages;
import com.jayway.jsonpath.JsonPath;

import jakarta.servlet.http.Cookie;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.S3Object;

// 画像・動画の添付（機能定義書 FN-09）を、API とテスト用の S3（MinIO）を通して確かめる。
// 画面の代わりに、API が返した署名付きの PUT の URL へ Java の HttpClient でファイルを送る。
// taro_y がオーナー、hanako がメンバー、jiro はワークスペースの外
@SpringBootTest
@Import({ TestcontainersConfiguration.class, MutableClock.Config.class })
@AutoConfigureMockMvc
class AttachmentApiTests {

	private static final int TEN_MB = 10 * 1024 * 1024;

	private static final int HUNDRED_MB = 100 * 1024 * 1024;

	@Autowired
	MockMvcTester mvc;

	@Autowired
	JdbcTemplate jdbc;

	@Autowired
	MinIOContainer minio;

	@Autowired
	AttachmentCleanup cleanup;

	private S3Client s3;

	private Cookie taro;

	private Cookie hanako;

	private Cookie jiro;

	private long workspace;

	private long general;

	@BeforeEach
	void setUp() {
		this.jdbc.execute("TRUNCATE users, refresh_tokens, workspaces, storage_deletions RESTART IDENTITY CASCADE");
		this.s3 = TestcontainersConfiguration.s3Client(this.minio);
		for (S3Object object : this.s3.listObjectsV2((r) -> r.bucket(TestcontainersConfiguration.BUCKET)).contents()) {
			this.s3.deleteObject((r) -> r.bucket(TestcontainersConfiguration.BUCKET).key(object.key()));
		}
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
		this.s3.close();
	}

	// ---- アップロード（AT-3、5 章）----

	// TC-09-6（5 章の 4）
	@Test
	void 大きな画像は幅と高さを記録し長い辺800pxの縮小した画像を作る() throws Exception {
		Map<String, Object> view = uploaded(this.taro, this.general, "写真.jpg", "image/jpeg",
				TestImages.jpeg(2000, 1000));

		assertThat(view).containsEntry("kind", "IMAGE")
			.containsEntry("contentType", "image/jpeg")
			.containsEntry("fileName", "写真.jpg")
			.containsEntry("width", 2000)
			.containsEntry("height", 1000);
		// 置き場所はワークスペースと乱数で作り、元のファイル名は使わない（5 章の 1）
		assertThat(keys()).hasSize(2)
			.allMatch(
					(key) -> key.matches("workspaces/" + this.workspace + "/attachments/[0-9a-f-]{36}(-thumb\\.jpg)?"));
		BufferedImage thumbnail = TestImages.read(download((String) view.get("thumbnailUrl"), "image/jpeg"));
		assertThat(thumbnail.getWidth()).isEqualTo(800);
		assertThat(thumbnail.getHeight()).isEqualTo(400);
		assertThat(download((String) view.get("url"), "image/jpeg")).hasSize(((Number) view.get("size")).intValue());
	}

	// 5 章の 4：透過のある画像の縮小した画像は PNG。800px 以下の画像は縮小した画像を作らず、元の画像を使う
	@Test
	void 透過のある画像の縮小はPNGで小さな画像は作らない() throws Exception {
		Map<String, Object> wide = uploaded(this.taro, this.general, "a.png", "image/png", TestImages.png(1600, 900));
		assertThat(keys()).anyMatch((key) -> key.endsWith("-thumb.png"));
		assertThat(TestImages.read(download((String) wide.get("thumbnailUrl"), "image/png")).getWidth()).isEqualTo(800);

		Map<String, Object> small = uploaded(this.taro, this.general, "b.png", "image/png", TestImages.png(300, 200));
		assertThat(small).containsEntry("width", 300).containsEntry("height", 200);
		assertThat((String) small.get("thumbnailUrl")).doesNotContain("-thumb");
		assertThat(keys()).hasSize(3);
	}

	@Test
	void GIFとWebPと動画も添付できる() throws Exception {
		assertThat(uploaded(this.taro, this.general, "a.gif", "image/gif", TestImages.gif(100, 100)))
			.containsEntry("width", 100);
		assertThat(uploaded(this.taro, this.general, "a.webp", "image/webp", TestImages.webp(true)))
			.containsEntry("width", 300);
		// 動画は変換せず、幅・高さは取らない（5 章の 5）
		Map<String, Object> video = uploaded(this.taro, this.general, "movie.mp4", "video/mp4", mp4(2048));
		assertThat(video).containsEntry("kind", "VIDEO")
			.containsEntry("width", null)
			.containsEntry("thumbnailUrl", null);
		assertThat(uploaded(this.taro, this.general, "movie.webm", "video/webm", webm(2048))).containsEntry("kind",
				"VIDEO");
	}

	// TC-09-1
	@Test
	void 画像は10MB動画は100MBまでで決めた形式だけ() {
		assertThat(createUpload(this.taro, this.general, "a.png", "image/png", TEN_MB)).hasStatus(HttpStatus.CREATED);
		assertError(createUpload(this.taro, this.general, "a.png", "image/png", TEN_MB + 1),
				ErrorCode.ATTACHMENT_TOO_LARGE, "size");
		assertThat(createUpload(this.taro, this.general, "a.mp4", "video/mp4", HUNDRED_MB))
			.hasStatus(HttpStatus.CREATED);
		assertError(createUpload(this.taro, this.general, "a.mp4", "video/mp4", HUNDRED_MB + 1),
				ErrorCode.ATTACHMENT_TOO_LARGE, "size");
		for (String type : List.of("application/pdf", "image/svg+xml", "image/heic", "text/html")) {
			assertError(createUpload(this.taro, this.general, "a", type, 10), ErrorCode.ATTACHMENT_TYPE_INVALID,
					"contentType");
		}
		assertError(createUpload(this.taro, this.general, "a.png", "image/png", 0), ErrorCode.BAD_REQUEST, "size");
		assertError(createUpload(this.taro, this.general, "", "image/png", 10), ErrorCode.BAD_REQUEST, "fileName");
		assertError(createUpload(this.taro, this.general, "あ".repeat(256), "image/png", 10), ErrorCode.BAD_REQUEST,
				"fileName");
	}

	// TC-09-2（5 章の 3）
	@Test
	void 拡張子だけ画像にしたHTMLはcompleteで断りS3からも消す() throws Exception {
		byte[] html = "<html><script>alert(1)</script></html>".getBytes(StandardCharsets.UTF_8);
		long id = uploadOnly(this.taro, this.general, "a.png", "image/png", html);

		assertError(complete(this.taro, id), ErrorCode.ATTACHMENT_TYPE_INVALID);

		assertThat(keys()).isEmpty();
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM attachments", Long.class)).isZero();
	}

	// TC-09-2（5 章の 2）：Content-Type を署名に含めているので、申告と違う形では置けない
	@Test
	void 申告と違うContentTypeではPUTできない() throws Exception {
		Map<String, Object> ticket = ticket(createUpload(this.taro, this.general, "a.png", "image/png", 10));
		HttpResponse<String> put = put((String) ticket.get("putUrl"),
				Map.of("Content-Type", "text/html", "If-None-Match", "*"), new byte[10]);
		assertThat(put.statusCode()).isEqualTo(403);
	}

	// FN-09 5 章の 2：complete で確かめた後に、同じ URL で中身を差し替えられない
	@Test
	void 一度置いたファイルは同じURLで置き換えられない() throws Exception {
		byte[] png = TestImages.png(10, 10);
		Map<String, Object> ticket = ticket(createUpload(this.taro, this.general, "a.png", "image/png", png.length));
		@SuppressWarnings("unchecked")
		Map<String, String> headers = (Map<String, String>) ticket.get("headers");
		assertThat(headers).containsEntry("If-None-Match", "*");
		assertThat(put((String) ticket.get("putUrl"), headers, png).statusCode()).isEqualTo(200);
		assertThat(complete(this.taro, ((Number) ticket.get("uploadId")).longValue())).hasStatusOk();

		byte[] html = new byte[png.length];
		HttpResponse<String> again = put((String) ticket.get("putUrl"), headers, html);

		assertThat(again.statusCode()).isEqualTo(412);
		HttpResponse<byte[]> stored = httpGet(
				this.minio.getS3URL() + "/" + TestcontainersConfiguration.BUCKET + "/" + keys().getFirst());
		// 署名なしでは読めないので、置いてあるものは S3 の API で確かめる
		assertThat(stored.statusCode()).isEqualTo(403);
		assertThat(this.s3.getObjectAsBytes((r) -> r.bucket(TestcontainersConfiguration.BUCKET).key(keys().getFirst()))
			.asByteArray()).isEqualTo(png);
	}

	@Test
	void PUTの前にcompleteすると400() {
		long id = readLong(createUpload(this.taro, this.general, "a.png", "image/png", 10), "$.uploadId");
		assertError(complete(this.taro, id), ErrorCode.UPLOAD_NOT_FOUND_IN_STORAGE);
	}

	@Test
	void completeを2回送っても同じものを返す() throws Exception {
		long id = uploadOnly(this.taro, this.general, "a.png", "image/png", TestImages.png(1000, 1000));
		assertThat(complete(this.taro, id)).hasStatusOk();
		assertThat(complete(this.taro, id)).hasStatusOk().bodyJson().extractingPath("$.width").isEqualTo(1000);
		assertThat(keys()).hasSize(2);
	}

	// TC-09-9
	@Test
	void ほかの人のアップロードは確かめることも外すこともできない() throws Exception {
		long id = uploadOnly(this.taro, this.general, "a.png", "image/png", TestImages.png(10, 10));
		assertError(complete(this.hanako, id), ErrorCode.UPLOAD_NOT_FOUND);
		assertError(delete(this.mvc, this.hanako, "/api/uploads/" + id), ErrorCode.UPLOAD_NOT_FOUND);
	}

	@Test
	void 送れない会話にはアップロードできない() {
		// ワークスペースの外の人
		assertError(createUpload(this.jiro, this.general, "a.png", "image/png", 10), ErrorCode.CONVERSATION_NOT_FOUND);
		// 参加していない公開チャンネル
		long channel = channel(this.taro, "雑談", "PUBLIC");
		assertError(createUpload(this.hanako, channel, "a.png", "image/png", 10), ErrorCode.NOT_CHANNEL_MEMBER);
		// 入っていないプライベートチャンネルは見えない
		long secret = channel(this.taro, "秘密", "PRIVATE");
		assertError(createUpload(this.hanako, secret, "a.png", "image/png", 10), ErrorCode.CONVERSATION_NOT_FOUND);
	}

	// TC-09-12（AT-1）
	@Test
	void 送る前に外すとS3からも消える() throws Exception {
		long id = id(uploaded(this.taro, this.general, "a.png", "image/png", TestImages.png(1000, 500)));

		assertThat(delete(this.mvc, this.taro, "/api/uploads/" + id)).hasStatus(HttpStatus.NO_CONTENT);

		assertThat(keys()).isEmpty();
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM attachments", Long.class)).isZero();
	}

	// ---- メッセージに付ける（FN-07、3.1）----

	@Test
	void 添付を付けて送ると選んだ順に並び一覧と1件の読み直しにも出る() throws Exception {
		long a = id(uploaded(this.taro, this.general, "1.png", "image/png", TestImages.png(10, 10)));
		long b = id(uploaded(this.taro, this.general, "2.mp4", "video/mp4", mp4(100)));

		MvcTestResult sent = send(this.taro, this.general, "", List.of(b, a));

		assertThat(sent).hasStatus(HttpStatus.CREATED);
		assertThat(sent).bodyJson().extractingPath("$.attachments[*].fileName").isEqualTo(List.of("2.mp4", "1.png"));
		long message = readLong(sent, "$.id");
		assertThat(get(this.mvc, this.hanako, "/api/conversations/%d/messages".formatted(this.general))).bodyJson()
			.extractingPath("$.items[0].attachments[*].id")
			.isEqualTo(List.of((int) b, (int) a));
		MvcTestResult one = get(this.mvc, this.hanako, "/api/messages/" + message);
		assertThat(one).hasStatusOk();
		assertThat(one).bodyJson().extractingPath("$.attachments[0].downloadUrl").asString().contains("attachment");
	}

	// TC-09-10：見られない会話のメッセージ（とその添付の URL）は受け取れない
	@Test
	void 見られないメッセージは1件でも読めない() throws Exception {
		long a = id(uploaded(this.taro, this.general, "1.png", "image/png", TestImages.png(10, 10)));
		long message = readLong(send(this.taro, this.general, "", List.of(a)), "$.id");
		assertError(get(this.mvc, this.jiro, "/api/messages/" + message), ErrorCode.MESSAGE_NOT_FOUND);
	}

	// FN-09 5 章の 3・6
	@Test
	void 表示のURLはContentTypeを固定しダウンロードのURLは元のファイル名で保存させる() throws Exception {
		Map<String, Object> view = uploaded(this.taro, this.general, "夏の写真.png", "image/png", TestImages.png(10, 10));
		HttpResponse<byte[]> shown = httpGet((String) view.get("url"));
		assertThat(shown.headers().firstValue("Content-Type")).hasValue("image/png");
		HttpResponse<byte[]> downloaded = httpGet((String) view.get("downloadUrl"));
		assertThat(downloaded.headers().firstValue("Content-Disposition"))
			.hasValueSatisfying((value) -> assertThat(value).startsWith("attachment;")
				.contains("filename*=UTF-8''%E5%A4%8F%E3%81%AE%E5%86%99%E7%9C%9F.png"));
	}

	// TC-09-3
	@Test
	void 添付は4個までで5個なら400() throws Exception {
		List<Long> ids = new ArrayList<>();
		for (int i = 0; i < 5; i++) {
			ids.add(id(uploaded(this.taro, this.general, i + ".png", "image/png", TestImages.png(10, 10))));
		}
		assertError(send(this.taro, this.general, "5 個", ids), ErrorCode.TOO_MANY_ATTACHMENTS, "attachmentIds");
		assertThat(send(this.taro, this.general, "4 個", ids.subList(0, 4))).hasStatus(HttpStatus.CREATED);
	}

	// TC-09-9（9 章）
	@Test
	void 自分のでない添付やほかの会話の添付や送り済みの添付は付けられない() throws Exception {
		long hanakos = id(uploaded(this.hanako, this.general, "h.png", "image/png", TestImages.png(10, 10)));
		long channel = channel(this.taro, "雑談", "PUBLIC");
		long otherConversation = id(uploaded(this.taro, channel, "o.png", "image/png", TestImages.png(10, 10)));
		long notCompleted = uploadOnly(this.taro, this.general, "n.png", "image/png", TestImages.png(10, 10));
		long sent = id(uploaded(this.taro, this.general, "s.png", "image/png", TestImages.png(10, 10)));
		assertThat(send(this.taro, this.general, "1 回目", List.of(sent))).hasStatus(HttpStatus.CREATED);

		for (long id : List.of(hanakos, otherConversation, notCompleted, sent, 9999L)) {
			assertError(send(this.taro, this.general, "本文", List.of(id)), ErrorCode.BAD_REQUEST, "attachmentIds");
		}
		assertError(send(this.taro, this.general, "本文", List.of(hanakos, hanakos)), ErrorCode.BAD_REQUEST,
				"attachmentIds");
		assertError(
				post(this.mvc, this.taro, "/api/conversations/%d/messages".formatted(this.general),
						"{\"body\":\"本文\",\"clientId\":\"%s\",\"attachmentIds\":[null]}".formatted(UUID.randomUUID())),
				ErrorCode.BAD_REQUEST, "attachmentIds");
		// 送れなかったものは何も付いていない
		assertThat(
				this.jdbc.queryForObject("SELECT count(*) FROM attachments WHERE message_id IS NOT NULL", Long.class))
			.isEqualTo(1);
	}

	@Test
	void 本文も添付もなければ送れない() {
		assertError(send(this.taro, this.general, "  ", List.of()), ErrorCode.MESSAGE_EMPTY, "body");
	}

	// ---- 消す（BR-12）----

	// TC-09-11（AT-9）
	@Test
	void 編集で外した添付はS3からも消える() throws Exception {
		long a = id(uploaded(this.taro, this.general, "a.png", "image/png", TestImages.png(1000, 1000)));
		long b = id(uploaded(this.taro, this.general, "b.png", "image/png", TestImages.png(10, 10)));
		long message = readLong(send(this.taro, this.general, "", List.of(a, b)), "$.id");

		MvcTestResult edited = patch(this.mvc, this.taro, "/api/messages/" + message,
				"{\"body\":\"\",\"keepAttachmentIds\":[%d]}".formatted(b));

		assertThat(edited).hasStatusOk();
		assertThat(edited).bodyJson().extractingPath("$.attachments[*].id").isEqualTo(List.of((int) b));
		assertThat(keys()).hasSize(1).allMatch((key) -> !key.endsWith("-thumb.png"));
		// 本文が空で添付もすべて外すことはできない
		assertError(patch(this.mvc, this.taro, "/api/messages/" + message, "{\"body\":\"\",\"keepAttachmentIds\":[]}"),
				ErrorCode.MESSAGE_EMPTY, "body");
		// 足すことはできない
		long c = id(uploaded(this.taro, this.general, "c.png", "image/png", TestImages.png(10, 10)));
		assertError(
				patch(this.mvc, this.taro, "/api/messages/" + message,
						"{\"body\":\"x\",\"keepAttachmentIds\":[%d,%d]}".formatted(b, c)),
				ErrorCode.BAD_REQUEST, "keepAttachmentIds");
		// keepAttachmentIds を送らなければ、すべて残す
		assertThat(patch(this.mvc, this.taro, "/api/messages/" + message, "{\"body\":\"直した\"}")).bodyJson()
			.extractingPath("$.attachments[*].id")
			.isEqualTo(List.of((int) b));
	}

	@Test
	void メッセージを消すと添付もS3から消える() throws Exception {
		long a = id(uploaded(this.taro, this.general, "a.png", "image/png", TestImages.png(1000, 1000)));
		long message = readLong(send(this.taro, this.general, "写真", List.of(a)), "$.id");

		assertThat(delete(this.mvc, this.taro, "/api/messages/" + message)).hasStatus(HttpStatus.NO_CONTENT);

		assertThat(keys()).isEmpty();
	}

	// 返信のある親メッセージは「削除されました」にし、添付は消す（MS-11）
	@Test
	void 削除されましたにした親メッセージの添付も消える() throws Exception {
		long a = id(uploaded(this.taro, this.general, "a.png", "image/png", TestImages.png(10, 10)));
		long message = readLong(send(this.taro, this.general, "写真", List.of(a)), "$.id");
		this.jdbc.update("UPDATE messages SET reply_count = 1 WHERE id = ?", message);

		MvcTestResult deleted = delete(this.mvc, this.taro, "/api/messages/" + message);

		assertThat(deleted).hasStatusOk();
		assertThat(deleted).bodyJson().extractingPath("$.attachments").asList().isEmpty();
		assertThat(keys()).isEmpty();
	}

	@Test
	void チャンネルを消すと添付もS3から消える() throws Exception {
		long channel = channel(this.taro, "雑談", "PUBLIC");
		long a = id(uploaded(this.taro, channel, "a.png", "image/png", TestImages.png(1000, 1000)));
		send(this.taro, channel, "", List.of(a));
		uploaded(this.taro, channel, "unsent.png", "image/png", TestImages.png(10, 10));
		uploaded(this.taro, this.general, "general.png", "image/png", TestImages.png(10, 10));

		assertThat(delete(this.mvc, this.taro, "/api/conversations/" + channel)).hasStatus(HttpStatus.NO_CONTENT);

		assertThat(keys()).singleElement().satisfies((key) -> assertThat(key).doesNotContain("-thumb"));
	}

	@Test
	void ワークスペースを消すと添付もS3から消える() throws Exception {
		long a = id(uploaded(this.taro, this.general, "a.png", "image/png", TestImages.png(1000, 1000)));
		send(this.taro, this.general, "", List.of(a));
		uploaded(this.hanako, this.general, "unsent.png", "image/png", TestImages.png(10, 10));

		assertThat(delete(this.mvc, this.taro, "/api/workspaces/" + this.workspace, "{\"confirmName\":\"仲間うち\"}"))
			.hasStatus(HttpStatus.NO_CONTENT);

		assertThat(keys()).isEmpty();
	}

	// TC-09-12（AT-11、BR-13）
	@Test
	void 送らずに24時間たった添付は1日1回の片付けで消える() throws Exception {
		long old = id(uploaded(this.taro, this.general, "old.png", "image/png", TestImages.png(1000, 1000)));
		long recent = id(uploaded(this.taro, this.general, "recent.png", "image/png", TestImages.png(10, 10)));
		long sentId = id(uploaded(this.taro, this.general, "sent.png", "image/png", TestImages.png(10, 10)));
		send(this.taro, this.general, "", List.of(sentId));
		this.jdbc.update("UPDATE attachments SET created_at = now() - interval '25 hours' WHERE id IN (?, ?)", old,
				sentId);

		this.cleanup.deleteUnsent();

		assertThat(this.jdbc.queryForList("SELECT id FROM attachments ORDER BY id", Long.class)).containsExactly(recent,
				sentId);
		assertThat(keys()).hasSize(2);
	}

	// ---- 準備 ----

	private Map<String, Object> uploaded(Cookie user, long conversationId, String fileName, String contentType,
			byte[] data) throws Exception {
		long id = uploadOnly(user, conversationId, fileName, contentType, data);
		MvcTestResult completed = complete(user, id);
		assertThat(completed).hasStatusOk();
		return JsonPath.read(content(completed), "$");
	}

	private long uploadOnly(Cookie user, long conversationId, String fileName, String contentType, byte[] data)
			throws Exception {
		MvcTestResult created = createUpload(user, conversationId, fileName, contentType, data.length);
		assertThat(created).hasStatus(HttpStatus.CREATED);
		Map<String, Object> ticket = ticket(created);
		@SuppressWarnings("unchecked")
		Map<String, String> headers = (Map<String, String>) ticket.get("headers");
		HttpResponse<String> put = put((String) ticket.get("putUrl"), headers, data);
		assertThat(put.statusCode()).as(put.body()).isEqualTo(200);
		return ((Number) ticket.get("uploadId")).longValue();
	}

	private MvcTestResult createUpload(Cookie user, long conversationId, String fileName, String contentType,
			long size) {
		return post(this.mvc, user, "/api/conversations/%d/uploads".formatted(conversationId),
				"{\"fileName\":\"%s\",\"contentType\":\"%s\",\"size\":%d}".formatted(fileName, contentType, size));
	}

	private MvcTestResult complete(Cookie user, long uploadId) {
		return post(this.mvc, user, "/api/uploads/%d/complete".formatted(uploadId), "{}");
	}

	private MvcTestResult send(Cookie user, long conversationId, String body, List<Long> attachmentIds) {
		return post(this.mvc, user, "/api/conversations/%d/messages".formatted(conversationId),
				"{\"body\":\"%s\",\"clientId\":\"%s\",\"attachmentIds\":[%s]}".formatted(body, UUID.randomUUID(),
						attachmentIds.stream().map(String::valueOf).collect(Collectors.joining(","))));
	}

	private long channel(Cookie user, String name, String visibility) {
		return readLong(
				post(this.mvc, user, "/api/workspaces/%d/channels".formatted(this.workspace),
						"{\"name\":\"%s\",\"description\":\"\",\"visibility\":\"%s\"}".formatted(name, visibility)),
				"$.id");
	}

	private List<String> keys() {
		return this.s3.listObjectsV2((r) -> r.bucket(TestcontainersConfiguration.BUCKET))
			.contents()
			.stream()
			.map(S3Object::key)
			.toList();
	}

	private static long id(Map<String, Object> view) {
		return ((Number) view.get("id")).longValue();
	}

	private static Map<String, Object> ticket(MvcTestResult result) {
		return JsonPath.read(content(result), "$");
	}

	private static String content(MvcTestResult result) {
		try {
			return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
		}
		catch (UnsupportedEncodingException ex) {
			throw new IllegalStateException(ex);
		}
	}

	// MP4 の先頭（"ftyp"）だけを持つファイル
	private static byte[] mp4(int size) {
		byte[] data = new byte[size];
		System.arraycopy(new byte[] { 0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm' }, 0, data, 0, 12);
		return data;
	}

	// WebM の先頭（EBML の印）だけを持つファイル
	private static byte[] webm(int size) {
		byte[] data = new byte[size];
		System.arraycopy(new byte[] { 0x1A, 0x45, (byte) 0xDF, (byte) 0xA3 }, 0, data, 0, 4);
		return data;
	}

	private static HttpResponse<String> put(String url, Map<String, String> headers, byte[] data)
			throws IOException, InterruptedException {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url))
			.PUT(HttpRequest.BodyPublishers.ofByteArray(data));
		headers.forEach(request::header);
		try (HttpClient client = HttpClient.newHttpClient()) {
			return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
		}
	}

	private static byte[] download(String url, String contentType) throws IOException, InterruptedException {
		HttpResponse<byte[]> got = httpGet(url);
		assertThat(got.statusCode()).isEqualTo(200);
		assertThat(got.headers().firstValue("Content-Type")).hasValue(contentType);
		return got.body();
	}

	private static HttpResponse<byte[]> httpGet(String url) throws IOException, InterruptedException {
		try (HttpClient client = HttpClient.newHttpClient()) {
			return client.send(HttpRequest.newBuilder(URI.create(url)).GET().build(),
					HttpResponse.BodyHandlers.ofByteArray());
		}
	}

}
