package com.example.raisechat.profile;

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
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
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

// プロフィール（機能定義書 FN-02）を、API とテスト用の S3（MinIO）を通して確かめる。10 章の「テストの観点」のうち、
// サーバー側で確かめられるもの。S3・データベースに失敗したときの後始末は ProfileServiceTests
@SpringBootTest
@Import({ TestcontainersConfiguration.class, MutableClock.Config.class })
@AutoConfigureMockMvc
class ProfileApiTests {

	private static final int FIVE_MB = 5 * 1024 * 1024;

	@Autowired
	MockMvcTester mvc;

	@Autowired
	MutableClock clock;

	@Autowired
	JdbcTemplate jdbc;

	@Autowired
	MinIOContainer minio;

	private S3Client s3;

	private Cookie taro;

	@BeforeEach
	void setUp() {
		this.jdbc.execute("TRUNCATE users, refresh_tokens, workspaces, storage_deletions RESTART IDENTITY CASCADE");
		this.clock.reset();
		this.s3 = TestcontainersConfiguration.s3Client(this.minio);
		for (S3Object object : objects()) {
			this.s3.deleteObject((request) -> request.bucket(TestcontainersConfiguration.BUCKET).key(object.key()));
		}
		this.taro = signup(this.mvc, "taro_y");
	}

	@AfterEach
	void tearDown() {
		this.s3.close();
	}

	// ---- 表示名とステータス（PF-1・PF-4〜PF-6）----

	@Test
	void はじめはアバターもステータスもない() {
		MvcTestResult result = get(this.mvc, this.taro, "/api/me/profile");
		assertThat(result).hasStatusOk();
		assertThat(result).bodyJson().isLenientlyEqualTo("""
				{"username":"taro_y","displayName":"taro_yの名前","avatarUrl":null,"statusEmoji":null,
				 "statusText":null,"statusExpiresAt":null}""");
	}

	@Test
	void 表示名とステータスを変える() {
		Instant expiresAt = this.clock.instant().plus(Duration.ofHours(1));
		MvcTestResult result = update("  たろう  ", "🏖️", "  休暇中  ", expiresAt);

		assertThat(result).hasStatusOk();
		assertThat(result).bodyJson().isLenientlyEqualTo("""
				{"username":"taro_y","displayName":"たろう","statusEmoji":"🏖️","statusText":"休暇中"}""");
		MvcTestResult profile = get(this.mvc, this.taro, "/api/me/profile");
		assertThat(profile).bodyJson().extractingPath("$.statusExpiresAt").isEqualTo(expiresAt.toString());
		// 自分の情報（FN-01）にも出る
		assertThat(get(this.mvc, this.taro, "/api/auth/me")).bodyJson()
			.extractingPath("$.displayName")
			.isEqualTo("たろう");
	}

	// TC-02-5
	@Test
	void 絵文字だけ文だけのステータスにできる() {
		assertThat(update("たろう", "😀", null, null)).bodyJson().isLenientlyEqualTo("""
				{"statusEmoji":"😀","statusText":null}""");
		assertThat(update("たろう", null, "あ".repeat(100), null)).bodyJson().isLenientlyEqualTo("""
				{"statusEmoji":null,"statusText":"%s"}""".formatted("あ".repeat(100)));
	}

	// FN-02 5 章の 3
	@Test
	void 絵文字も文も空なら消す時刻もなくす() {
		update("たろう", "", "  ", this.clock.instant().plus(Duration.ofHours(1)));
		assertThat(get(this.mvc, this.taro, "/api/me/profile")).bodyJson().isLenientlyEqualTo("""
				{"statusEmoji":null,"statusText":null,"statusExpiresAt":null}""");
	}

	// TC-02-5（FN-02 5 章の 2）。G-16 にも出ない。
	// 時計をアクセストークンの期限（15 分）より進めるとログインが切れるので、消す時刻は 10 分後にする
	@Test
	void 消す時刻を過ぎたステータスはどこにも出ない() {
		update("たろう", "🏖️", "休暇中", this.clock.instant().plus(Duration.ofMinutes(10)));
		long workspace = readLong(createWorkspace(this.mvc, this.taro, "仲間うち"), "$.id");

		this.clock.advance(Duration.ofMinutes(10));

		assertThat(get(this.mvc, this.taro, "/api/me/profile")).bodyJson().isLenientlyEqualTo("""
				{"statusEmoji":null,"statusText":null,"statusExpiresAt":null}""");
		assertThat(get(this.mvc, this.taro, "/api/workspaces/%d/members/taro_y".formatted(workspace))).bodyJson()
			.isLenientlyEqualTo("""
					{"statusEmoji":null,"statusText":null,"statusExpiresAt":null}""");
		// データベースの値は、次に保存したときに上書きする
		assertThat(this.jdbc.queryForObject("SELECT status_text FROM users", String.class)).isEqualTo("休暇中");
	}

	// TC-02-4
	@Test
	void 表示名は前後の空白を除いて1文字から30文字() {
		assertError(update("  ", null, null, null), ErrorCode.DISPLAY_NAME_REQUIRED, "displayName");
		assertThat(update("あ", null, null, null)).hasStatusOk();
		assertThat(update("あ".repeat(30), null, null, null)).hasStatusOk();
		assertError(update("あ".repeat(31), null, null, null), ErrorCode.BAD_REQUEST, "displayName");
	}

	@Test
	void 条件に合わないステータスは保存しない() {
		assertError(update("たろう", "😀😀", null, null), ErrorCode.BAD_REQUEST, "statusEmoji");
		assertError(update("たろう", null, "あ".repeat(101), null), ErrorCode.BAD_REQUEST, "statusText");
		assertError(update("たろう", null, "休暇\n中", null), ErrorCode.BAD_REQUEST, "statusText");
		assertError(update("たろう", "😀", null, this.clock.instant()), ErrorCode.BAD_REQUEST, "statusExpiresAt");
		assertThat(this.jdbc.queryForObject("SELECT display_name FROM users", String.class)).isEqualTo("taro_yの名前");
	}

	// TC-02-6：文字のまま保存し、そのまま返す（画面が文字として出す）
	@Test
	void ステータスの文のタグはそのまま返す() {
		assertThat(update("たろう", null, "<script>alert(1)</script>", null)).bodyJson()
			.extractingPath("$.statusText")
			.isEqualTo("<script>alert(1)</script>");
	}

	// ---- アバター（PF-2・PF-3）----

	// TC-02-2
	@Test
	void 横長の画像は真ん中を正方形に切り取り256pxのPNGで置き署名付きURLで読める() throws Exception {
		MvcTestResult result = uploadAvatar(TestImages.png(600, 300));

		assertThat(result).hasStatusOk();
		List<String> keys = keys();
		assertThat(keys).singleElement()
			.asString()
			.matches("avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.png");
		assertThat(
				this.s3.headObject((request) -> request.bucket(TestcontainersConfiguration.BUCKET).key(keys.getFirst()))
					.contentType())
			.isEqualTo("image/png");
		BufferedImage avatar = TestImages.read(download(avatarUrl(result)));
		assertThat(avatar.getWidth()).isEqualTo(256);
		assertThat(avatar.getHeight()).isEqualTo(256);
		assertThat(new Color(avatar.getRGB(0, 0))).isEqualTo(Color.RED);
		assertThat(new Color(avatar.getRGB(255, 255))).isEqualTo(Color.RED);
	}

	// TC-02-2
	@Test
	void 縦長のJPEGとWebPも使える() throws Exception {
		assertThat(uploadAvatar(TestImages.jpeg(200, 500))).hasStatusOk();
		MvcTestResult webp = uploadAvatar(TestImages.webp(false));
		assertThat(webp).hasStatusOk();
		assertThat(TestImages.read(download(avatarUrl(webp))).getWidth()).isEqualTo(256);
	}

	// TC-02-2（N-11）
	@Test
	void アバターを替えると前のファイルを消す() {
		uploadAvatar(TestImages.png(300, 300));
		String first = keys().getFirst();

		uploadAvatar(TestImages.png(300, 300));

		assertThat(keys()).singleElement().isNotEqualTo(first);
		assertThat(this.jdbc.queryForObject("SELECT avatar_key FROM users", String.class)).isEqualTo(keys().getFirst());
	}

	// TC-02-3
	@Test
	void アバターを外すとファイルも消す() {
		uploadAvatar(TestImages.png(300, 300));

		MvcTestResult result = delete(this.mvc, this.taro, "/api/me/avatar");

		assertThat(result).hasStatusOk();
		assertThat(result).bodyJson().extractingPath("$.avatarUrl").isNull();
		assertThat(keys()).isEmpty();
		assertThat(this.jdbc.queryForObject("SELECT avatar_key FROM users", String.class)).isNull();
		// アバターがないときに外しても、何もしない
		assertThat(delete(this.mvc, this.taro, "/api/me/avatar")).hasStatusOk();
	}

	// TC-02-1
	@Test
	void ちょうど5MBまでの画像を使える() {
		assertThat(uploadAvatar(TestImages.paddedTo(TestImages.png(300, 300), FIVE_MB))).hasStatusOk();
		assertError(uploadAvatar(TestImages.paddedTo(TestImages.png(300, 300), FIVE_MB + 1)),
				ErrorCode.AVATAR_TOO_LARGE, "file");
	}

	// TC-02-1
	@Test
	void GIFとSVGと拡張子だけ変えたファイルと壊れた画像は使えない() {
		assertError(uploadAvatar(TestImages.gif(300, 300)), ErrorCode.AVATAR_INVALID, "file");
		assertError(uploadAvatar("<svg xmlns=\"http://www.w3.org/2000/svg\"/>".getBytes(StandardCharsets.UTF_8)),
				ErrorCode.AVATAR_INVALID, "file");
		assertError(uploadAvatar("ただのテキスト".getBytes(StandardCharsets.UTF_8)), ErrorCode.AVATAR_INVALID, "file");
		byte[] png = TestImages.png(300, 300);
		assertError(uploadAvatar(Arrays.copyOf(png, png.length / 2)), ErrorCode.AVATAR_INVALID, "file");
		assertThat(keys()).isEmpty();
	}

	// N-20
	@Test
	void バケットのURLを署名なしで開いてもアバターは見られない() throws Exception {
		uploadAvatar(TestImages.png(300, 300));
		HttpResponse<byte[]> got = httpGet(
				this.minio.getS3URL() + "/" + TestcontainersConfiguration.BUCKET + "/" + keys().getFirst());
		assertThat(got.statusCode()).isEqualTo(403);
	}

	// FN-02 5 章の 4（N-20）
	@Test
	void アバターのURLは1時間で切れる() {
		String url = avatarUrl(uploadAvatar(TestImages.png(300, 300)));
		assertThat(url).contains("X-Amz-Expires=3600");
	}

	// ---- G-16（PF-7・PF-9）----

	// TC-02-8・TC-02-9
	@Test
	void 同じワークスペースの人のプロフィールだけを見られる() {
		Cookie hanako = signup(this.mvc, "hanako");
		Cookie jiro = signup(this.mvc, "jiro");
		long workspace = readLong(createWorkspace(this.mvc, this.taro, "仲間うち"), "$.id");
		join(this.jdbc, workspace, "hanako");
		uploadAvatar(TestImages.png(300, 300));
		Instant expiresAt = this.clock.instant().plus(Duration.ofHours(1));
		update("たろう", "🏖️", "休暇中", expiresAt);

		MvcTestResult seen = get(this.mvc, hanako, "/api/workspaces/%d/members/taro_y".formatted(workspace));
		assertThat(seen).hasStatusOk();
		assertThat(seen).bodyJson().isLenientlyEqualTo("""
				{"username":"taro_y","displayName":"たろう","statusEmoji":"🏖️","statusText":"休暇中",
				 "statusExpiresAt":"%s","role":"OWNER"}""".formatted(expiresAt));
		assertThat(seen).bodyJson().extractingPath("$.avatarUrl").asString().contains(keys().getFirst());
		// メンバーの一覧にも新しい表示名・アバターが出る
		assertThat(get(this.mvc, hanako, "/api/workspaces/%d/members".formatted(workspace))).bodyJson()
			.extractingPath("$.items[0].displayName")
			.isEqualTo("たろう");

		// ワークスペースにいない人は見られない・ワークスペースにいない人を見ようとしても 404
		assertError(get(this.mvc, jiro, "/api/workspaces/%d/members/taro_y".formatted(workspace)),
				ErrorCode.WORKSPACE_NOT_FOUND);
		assertError(get(this.mvc, hanako, "/api/workspaces/%d/members/jiro".formatted(workspace)),
				ErrorCode.USER_NOT_FOUND);
	}

	// PF-8：変えた後に読み込んだメッセージ（変える前に送ったものも）には、新しい表示名・ステータスが出る
	@Test
	void 変える前に送ったメッセージも次に読み込むと新しいプロフィールで出る() {
		Cookie hanako = signup(this.mvc, "hanako");
		MvcTestResult created = createWorkspace(this.mvc, this.taro, "仲間うち");
		long general = readLong(created, "$.generalConversationId");
		join(this.jdbc, readLong(created, "$.id"), "hanako");
		post(this.mvc, this.taro, "/api/conversations/%d/messages".formatted(general),
				"{\"body\":\"前の名前で送る\",\"clientId\":\"%s\"}".formatted(UUID.randomUUID()));

		update("たろう", "🏖️", "休暇中", null);

		assertThat(get(this.mvc, hanako, "/api/conversations/%d/messages".formatted(general))).bodyJson()
			.isLenientlyEqualTo("""
					{"items":[{"body":"前の名前で送る",
					 "author":{"username":"taro_y","displayName":"たろう","statusEmoji":"🏖️","statusText":"休暇中"}}]}""");
	}

	private MvcTestResult update(@Nullable String displayName, @Nullable String emoji, @Nullable String text,
			@Nullable Instant expiresAt) {
		return patch(this.mvc, this.taro, "/api/me/profile", """
				{"displayName":%s,"statusEmoji":%s,"statusText":%s,"statusExpiresAt":%s}""".formatted(json(displayName),
				json(emoji), json(text), json((expiresAt == null) ? null : expiresAt.toString())));
	}

	private static String json(@Nullable String value) {
		return (value == null) ? "null" : "\"" + value.replace("\n", "\\n").replace("\r", "\\r") + "\"";
	}

	private MvcTestResult uploadAvatar(byte[] data) {
		return this.mvc.perform(multipart(HttpMethod.PUT, "/api/me/avatar")
			.file(new MockMultipartFile("file", "avatar.png", "image/png", data))
			.cookie(this.taro)
			.with(csrf()));
	}

	private static String avatarUrl(MvcTestResult result) {
		try {
			return JsonPath.read(result.getResponse().getContentAsString(StandardCharsets.UTF_8), "$.avatarUrl");
		}
		catch (UnsupportedEncodingException ex) {
			throw new IllegalStateException(ex);
		}
	}

	private List<S3Object> objects() {
		return this.s3.listObjectsV2((request) -> request.bucket(TestcontainersConfiguration.BUCKET)).contents();
	}

	private List<String> keys() {
		return objects().stream().map(S3Object::key).toList();
	}

	private static byte[] download(String url) throws IOException, InterruptedException {
		HttpResponse<byte[]> got = httpGet(url);
		assertThat(got.statusCode()).isEqualTo(200);
		assertThat(got.headers().firstValue("Content-Type")).hasValue("image/png");
		return got.body();
	}

	private static HttpResponse<byte[]> httpGet(String url) throws IOException, InterruptedException {
		try (HttpClient client = HttpClient.newHttpClient()) {
			return client.send(HttpRequest.newBuilder(URI.create(url)).GET().build(),
					HttpResponse.BodyHandlers.ofByteArray());
		}
	}

}
