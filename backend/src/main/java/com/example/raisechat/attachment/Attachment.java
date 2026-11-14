package com.example.raisechat.attachment;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.jspecify.annotations.Nullable;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

// 添付ファイル（データ設計書 4.8）。アップロードを受け付けたら UPLOADING、complete で確かめたら READY。
// 送ったら message_id と並び順を入れる
@Entity
@Table(name = "attachments")
public class Attachment {

	public enum Status {

		UPLOADING, READY

	}

	public enum Kind {

		IMAGE, VIDEO

	}

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private @Nullable Long id;

	@Column(nullable = false, updatable = false)
	private long conversationId;

	@Column(nullable = false, updatable = false)
	private long uploaderId;

	private @Nullable Long messageId;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private Status status;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, updatable = false)
	private Kind kind;

	@Column(nullable = false, updatable = false)
	private String contentType;

	@Column(nullable = false, updatable = false)
	private long byteSize;

	@Column(nullable = false, updatable = false)
	private String fileName;

	@Column(nullable = false, updatable = false)
	private String storageKey;

	private @Nullable String thumbnailKey;

	private @Nullable Integer width;

	private @Nullable Integer height;

	private @Nullable Short sortOrder;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	protected Attachment() {
		this(0, 0, AttachmentFormat.PNG, 1, "", "", Instant.EPOCH);
	}

	Attachment(long conversationId, long uploaderId, AttachmentFormat format, long byteSize, String fileName,
			String storageKey, Instant now) {
		this.conversationId = conversationId;
		this.uploaderId = uploaderId;
		this.status = Status.UPLOADING;
		this.kind = format.kind();
		this.contentType = format.contentType();
		this.byteSize = byteSize;
		this.fileName = fileName;
		this.storageKey = storageKey;
		this.createdAt = now;
	}

	// complete で確かめた（FN-09 3.1）。幅・高さ・縮小した画像は、分かったときだけ
	void markReady(@Nullable Integer width, @Nullable Integer height, @Nullable String thumbnailKey) {
		this.status = Status.READY;
		this.width = width;
		this.height = height;
		this.thumbnailKey = thumbnailKey;
	}

	// 送ったメッセージに結びつける（sortOrder は 0〜3）
	void attachTo(long messageId, int sortOrder) {
		this.messageId = messageId;
		this.sortOrder = (short) sortOrder;
	}

	// S3 に置いたファイル（縮小した画像を含む）
	List<String> storageKeys() {
		List<String> keys = new ArrayList<>(List.of(this.storageKey));
		if (this.thumbnailKey != null) {
			keys.add(this.thumbnailKey);
		}
		return keys;
	}

	public long getId() {
		if (this.id == null) {
			throw new IllegalStateException("まだ保存していない添付です");
		}
		return this.id;
	}

	public long getConversationId() {
		return this.conversationId;
	}

	public long getUploaderId() {
		return this.uploaderId;
	}

	public @Nullable Long getMessageId() {
		return this.messageId;
	}

	public Status getStatus() {
		return this.status;
	}

	public Kind getKind() {
		return this.kind;
	}

	public String getContentType() {
		return this.contentType;
	}

	public long getByteSize() {
		return this.byteSize;
	}

	public String getFileName() {
		return this.fileName;
	}

	public String getStorageKey() {
		return this.storageKey;
	}

	public @Nullable String getThumbnailKey() {
		return this.thumbnailKey;
	}

	public @Nullable Integer getWidth() {
		return this.width;
	}

	public @Nullable Integer getHeight() {
		return this.height;
	}

	public @Nullable Short getSortOrder() {
		return this.sortOrder;
	}

	public Instant getCreatedAt() {
		return this.createdAt;
	}

}
