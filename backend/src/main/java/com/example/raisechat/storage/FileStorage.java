package com.example.raisechat.storage;

import java.time.Duration;

import org.springframework.stereotype.Component;

import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

// S3 にファイルを置く・消す・署名付き URL を作る（アバターは FN-02、添付は FN-09）。
// S3 との通信に失敗したときは、AWS SDK の例外（SdkException）がそのまま出る
@Component
public class FileStorage {

	// 署名付き URL の有効期限（N-20）
	static final Duration URL_TTL = Duration.ofHours(1);

	private final S3Client s3;

	private final S3Presigner presigner;

	private final String bucket;

	FileStorage(S3Client s3, S3Presigner presigner, StorageProperties properties) {
		this.s3 = s3;
		this.presigner = presigner;
		this.bucket = properties.bucket();
	}

	// Content-Type を付けて置く。ブラウザが画像として表示するため
	public void put(String key, String contentType, byte[] data) {
		this.s3.putObject(PutObjectRequest.builder().bucket(this.bucket).key(key).contentType(contentType).build(),
				RequestBody.fromBytes(data));
	}

	public void delete(String key) {
		this.s3.deleteObject(DeleteObjectRequest.builder().bucket(this.bucket).key(key).build());
	}

	// URL は手元で計算するので、S3 とは通信しない
	public String signedUrl(String key) {
		return this.presigner
			.presignGetObject(GetObjectPresignRequest.builder()
				.signatureDuration(URL_TTL)
				.getObjectRequest(GetObjectRequest.builder().bucket(this.bucket).key(key).build())
				.build())
			.url()
			.toString();
	}

}
