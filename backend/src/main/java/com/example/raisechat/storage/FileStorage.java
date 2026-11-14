package com.example.raisechat.storage;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.OptionalLong;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

// S3 にファイルを置く・読む・消す・署名付き URL を作る（アバターは FN-02、添付は FN-09）。
// S3 との通信に失敗したときは、AWS SDK の例外（SdkException）がそのまま出る
@Component
public class FileStorage {

	// 表示・ダウンロードの署名付き URL の有効期限（N-20）
	static final Duration URL_TTL = Duration.ofHours(1);

	// 画面から直接アップロードする署名付きの PUT の URL の有効期限（FN-09 5 章の 2）
	static final Duration PUT_URL_TTL = Duration.ofMinutes(15);

	private final S3Client s3;

	private final S3Presigner presigner;

	private final String bucket;

	private final Clock clock;

	FileStorage(S3Client s3, S3Presigner presigner, StorageProperties properties, Clock clock) {
		this.s3 = s3;
		this.presigner = presigner;
		this.bucket = properties.bucket();
		this.clock = clock;
	}

	// Content-Type を付けて置く。ブラウザが画像として表示するため
	public void put(String key, String contentType, byte[] data) {
		this.s3.putObject(PutObjectRequest.builder().bucket(this.bucket).key(key).contentType(contentType).build(),
				RequestBody.fromBytes(data));
	}

	public void delete(String key) {
		this.s3.deleteObject(DeleteObjectRequest.builder().bucket(this.bucket).key(key).build());
	}

	// 置いてあるファイルの大きさ。ないときは空（まだ PUT が終わっていない）
	public OptionalLong size(String key) {
		try {
			return OptionalLong.of(this.s3.headObject(HeadObjectRequest.builder().bucket(this.bucket).key(key).build())
				.contentLength());
		}
		catch (S3Exception ex) {
			if (ex.statusCode() == 404) {
				return OptionalLong.empty();
			}
			throw ex;
		}
	}

	// 先頭の length バイト（形式を確かめるため。FN-09 5 章の 3）
	public byte[] readHead(String key, int length) {
		return this.s3
			.getObjectAsBytes(
					GetObjectRequest.builder().bucket(this.bucket).key(key).range("bytes=0-" + (length - 1)).build())
			.asByteArray();
	}

	// 全体（画像の縮小のため。10MB まで）
	public byte[] read(String key) {
		return this.s3.getObjectAsBytes(GetObjectRequest.builder().bucket(this.bucket).key(key).build()).asByteArray();
	}

	// 表示用の署名付き URL。URL は手元で計算するので、S3 とは通信しない
	public String signedUrl(String key) {
		return signedUrl(key, null, null);
	}

	// contentType を渡すと、応答の Content-Type をそれに固定する（FN-09 5 章の 3。N-21）。
	// downloadName を渡すと、その名前で保存されるよう Content-Disposition（attachment）を付ける（FN-09 5 章の 6）
	public String signedUrl(String key, @Nullable String contentType, @Nullable String downloadName) {
		GetObjectRequest.Builder request = GetObjectRequest.builder().bucket(this.bucket).key(key);
		if (contentType != null) {
			request.responseContentType(contentType);
		}
		if (downloadName != null) {
			request.responseContentDisposition(attachment(downloadName));
		}
		return this.presigner.presignGetObject(
				GetObjectPresignRequest.builder().signatureDuration(URL_TTL).getObjectRequest(request.build()).build())
			.url()
			.toString();
	}

	// 署名付き URL の期限（画面に渡す。URL の期限とそろえる）
	public Instant urlExpiresAt() {
		return this.clock.instant().plus(URL_TTL);
	}

	// 画面から直接置くための署名付きの PUT の URL。Content-Type と Content-Length を署名に含め、
	// 申告と違うファイルを置けないようにする（FN-09 5 章の 2）
	public PutUrl signedPutUrl(String key, String contentType, long contentLength) {
		PresignedPutObjectRequest presigned = this.presigner.presignPutObject(PutObjectPresignRequest.builder()
			.signatureDuration(PUT_URL_TTL)
			.putObjectRequest(PutObjectRequest.builder()
				.bucket(this.bucket)
				.key(key)
				.contentType(contentType)
				.contentLength(contentLength)
				.build())
			.build());
		return new PutUrl(presigned.url().toString(), Map.of("Content-Type", contentType), presigned.expiration());
	}

	// 日本語のファイル名も崩れないよう、RFC 6266 の filename*（UTF-8）で書く。filename は ASCII だけの代わりの名前
	static String attachment(String fileName) {
		String ascii = fileName.replaceAll("[^\\x20-\\x7E]", "_").replace("\"", "_").replace("\\", "_");
		String encoded = URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");
		return "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded;
	}

	// headers：PUT のときに付けるヘッダー（署名に含めたもの）。Content-Length はブラウザが付ける
	public record PutUrl(String url, Map<String, String> headers, Instant expiresAt) {
	}

}
