package com.example.raisechat.attachment;

import java.time.Instant;

import org.jspecify.annotations.Nullable;

import com.example.raisechat.storage.FileStorage;

// 添付（機能定義書 3.5 の MessageView の attachments の 1 つ。FN-09 の AttachmentView）。
// URL はどれも署名付き URL（1 時間。N-20）。url は表示用（Content-Type を記録した形式に固定）、
// thumbnailUrl は縮小した画像（作らなかった画像は url と同じ。動画は null）、downloadUrl は元のファイル名で保存させるもの
public record AttachmentView(long id, Attachment.Kind kind, String contentType, String fileName, long size,
		@Nullable Integer width, @Nullable Integer height, String url, @Nullable String thumbnailUrl,
		String downloadUrl, Instant expiresAt) {

	static AttachmentView of(Attachment a, FileStorage storage) {
		String url = storage.signedUrl(a.getStorageKey(), a.getContentType(), null);
		String thumbnailKey = a.getThumbnailKey();
		String thumbnailUrl = (a.getKind() == Attachment.Kind.VIDEO) ? null
				: (thumbnailKey == null) ? url : storage.signedUrl(thumbnailKey, thumbnailType(thumbnailKey), null);
		return new AttachmentView(a.getId(), a.getKind(), a.getContentType(), a.getFileName(), a.getByteSize(),
				a.getWidth(), a.getHeight(), url, thumbnailUrl,
				storage.signedUrl(a.getStorageKey(), a.getContentType(), a.getFileName()), storage.urlExpiresAt());
	}

	private static String thumbnailType(String key) {
		return key.endsWith(".png") ? "image/png" : "image/jpeg";
	}

}
