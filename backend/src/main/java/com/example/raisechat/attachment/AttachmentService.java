package com.example.raisechat.attachment;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.UUID;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.conversation.Conversation;
import com.example.raisechat.conversation.ConversationAccess;
import com.example.raisechat.conversation.ConversationRepository;
import com.example.raisechat.storage.FileStorage;
import com.example.raisechat.storage.Images;
import com.example.raisechat.storage.StorageDeleter;

// 添付のアップロード（機能定義書 FN-09 3.1）。ファイルは画面から S3 へ直接送り、API は受け付け（署名付きの PUT の URL を渡す）と
// 確かめ（complete）と、送る前に外すことだけを行う
@Service
class AttachmentService {

	// 縮小した画像の長い辺（FN-09 5 章の 4）
	static final int THUMBNAIL_SIZE = 800;

	// ファイル名の長さ（FN-09 4 章）
	static final int MAX_FILE_NAME = 255;

	private final AttachmentRepository attachments;

	private final ConversationAccess access;

	private final ConversationRepository conversations;

	private final FileStorage storage;

	private final StorageDeleter deleter;

	private final TransactionTemplate transaction;

	private final Clock clock;

	AttachmentService(AttachmentRepository attachments, ConversationAccess access, ConversationRepository conversations,
			FileStorage storage, StorageDeleter deleter, TransactionTemplate transaction, Clock clock) {
		this.attachments = attachments;
		this.access = access;
		this.conversations = conversations;
		this.storage = storage;
		this.deleter = deleter;
		this.transaction = transaction;
		this.clock = clock;
	}

	// アップロードを受け付ける（AT-3）。送れる会話のときだけ。S3 の置き場所は推測できない乱数で作る（5 章の 1）
	@Transactional
	UploadTicket create(long me, long conversationId, @Nullable String rawFileName, @Nullable String contentType,
			@Nullable Long size) {
		AttachmentFormat format = AttachmentFormat.of((contentType == null) ? "" : contentType)
			.orElseThrow(() -> new ApiException(ErrorCode.ATTACHMENT_TYPE_INVALID, "contentType"));
		if (size == null || size <= 0) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "size");
		}
		if (size > format.maxBytes()) {
			throw new ApiException(ErrorCode.ATTACHMENT_TOO_LARGE, "size");
		}
		String fileName = (rawFileName == null) ? "" : rawFileName.strip();
		int length = fileName.codePointCount(0, fileName.length());
		if (length < 1 || length > MAX_FILE_NAME) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "fileName");
		}
		Conversation conversation = this.access.requireVisible(me, conversationId);
		this.access.requireCanPost(me, conversation);
		String key = "workspaces/%d/attachments/%s".formatted(conversation.getWorkspaceId(), UUID.randomUUID());
		Attachment attachment = this.attachments
			.save(new Attachment(conversationId, me, format, size, fileName, key, this.clock.instant()));
		FileStorage.PutUrl put = this.storage.signedPutUrl(key, format.contentType(), size);
		return new UploadTicket(attachment.getId(), put.url(), put.headers(), put.expiresAt());
	}

	// アップロードを確かめる（FN-09 3.1）。大きさ・先頭のバイトで形式を確かめ、画像なら幅・高さを読み、
	// 縮小した画像を作って置く。形式が申告と違えば、S3 のファイルと記録を消して 400（5 章の 3）。
	// S3 の読み書きはトランザクションの外で行い、最後に行をロックして記録する
	AttachmentView complete(long me, long uploadId) {
		Attachment attachment = requireOwnUnsent(me, uploadId);
		if (attachment.getStatus() == Attachment.Status.READY) {
			return AttachmentView.of(attachment, this.storage);
		}
		AttachmentFormat format = AttachmentFormat.of(attachment.getContentType()).orElseThrow();
		OptionalLong stored = this.storage.size(attachment.getStorageKey());
		if (stored.isEmpty()) {
			throw new ApiException(ErrorCode.UPLOAD_NOT_FOUND_IN_STORAGE);
		}
		if (stored.getAsLong() != attachment.getByteSize()
				|| !format.matches(this.storage.readHead(attachment.getStorageKey(), AttachmentFormat.HEAD_BYTES))) {
			throw reject(attachment);
		}
		Integer width = null;
		Integer height = null;
		String thumbnailKey = null;
		if (format.kind() == Attachment.Kind.IMAGE) {
			// 先頭は画像の形でも、読めない（壊れている・大きすぎる）画像は添付できない
			Images.Decoded decoded = Images
				.readForThumbnail(this.storage.read(attachment.getStorageKey()), THUMBNAIL_SIZE)
				.orElseThrow(() -> reject(attachment));
			width = decoded.width();
			height = decoded.height();
			thumbnailKey = putThumbnail(attachment.getStorageKey(), decoded);
		}
		Integer w = width;
		Integer h = height;
		String thumbnail = thumbnailKey;
		Optional<AttachmentView> view = this.transaction
			.execute((status) -> this.attachments.findByIdForUpdate(uploadId).map((locked) -> {
				if (locked.getStatus() == Attachment.Status.UPLOADING) {
					locked.markReady(w, h, thumbnail);
				}
				return AttachmentView.of(locked, this.storage);
			}));
		if (view == null || view.isEmpty()) {
			// 読み書きしている間に外された（DELETE・1 日 1 回の片付け）。外した側は縮小した画像を知らないので、ここで消す
			if (thumbnail != null) {
				this.deleter.deleteOrRecord(List.of(thumbnail));
			}
			throw new ApiException(ErrorCode.UPLOAD_NOT_FOUND);
		}
		return view.get();
	}

	// 送る前に外す（AT-1）。行を消し、コミットの後で S3 のファイルを消す
	@Transactional
	void cancel(long me, long uploadId) {
		Attachment attachment = this.attachments.findByIdForUpdate(uploadId)
			.filter((a) -> a.getUploaderId() == me && a.getMessageId() == null)
			.orElseThrow(() -> new ApiException(ErrorCode.UPLOAD_NOT_FOUND));
		this.attachments.delete(attachment);
		this.deleter.deleteAfterCommit(attachment.storageKeys());
	}

	// 自分のもので、送っていないもの。会話を見られなくなっていれば（キック・退出・削除）もう使えない
	private Attachment requireOwnUnsent(long me, long uploadId) {
		Attachment attachment = this.attachments.findById(uploadId)
			.filter((a) -> a.getUploaderId() == me && a.getMessageId() == null)
			.orElseThrow(() -> new ApiException(ErrorCode.UPLOAD_NOT_FOUND));
		if (this.conversations.findVisible(me, attachment.getConversationId()).isEmpty()) {
			throw new ApiException(ErrorCode.UPLOAD_NOT_FOUND);
		}
		return attachment;
	}

	// 長い辺が 800px より大きい画像だけ作る。透過のあるものは PNG、ほかは JPEG（5 章の 4）。
	// 置き場所は元のファイルから決めるので、同じ添付の complete が同時に来ても同じところに置く
	private @Nullable String putThumbnail(String storageKey, Images.Decoded decoded) {
		if (Math.max(decoded.width(), decoded.height()) <= THUMBNAIL_SIZE) {
			return null;
		}
		var thumbnail = Images.fit(decoded.image(), THUMBNAIL_SIZE);
		boolean alpha = Images.hasAlpha(thumbnail);
		String key = storageKey + (alpha ? "-thumb.png" : "-thumb.jpg");
		this.storage.put(key, alpha ? "image/png" : "image/jpeg",
				alpha ? Images.png(thumbnail) : Images.jpeg(thumbnail));
		return key;
	}

	// 形式が違う（中身が申告と違う）。S3 のファイルと記録を消し、返す 400 の例外を作る
	private ApiException reject(Attachment attachment) {
		this.transaction.executeWithoutResult(
				(status) -> this.attachments.findByIdForUpdate(attachment.getId()).ifPresent(this.attachments::delete));
		this.deleter.deleteOrRecord(attachment.storageKeys());
		return new ApiException(ErrorCode.ATTACHMENT_TYPE_INVALID);
	}

	// putUrl に、headers のヘッダーを付けて PUT する。期限は expiresAt（15 分）
	record UploadTicket(long uploadId, String putUrl, Map<String, String> headers, Instant expiresAt) {
	}

}
