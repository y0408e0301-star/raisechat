package com.example.raisechat.attachment;

import java.util.Arrays;
import java.util.Optional;

import com.example.raisechat.storage.ImageFormat;

// 添付できる形式（FN-09 4 章、データ要件定義書 6.1）。申告された Content-Type で決め、complete のときに
// ファイルの先頭のバイト（マジックナンバー）でも確かめる（5 章の 3）
enum AttachmentFormat {

	JPEG("image/jpeg", Attachment.Kind.IMAGE),

	PNG("image/png", Attachment.Kind.IMAGE),

	GIF("image/gif", Attachment.Kind.IMAGE),

	WEBP("image/webp", Attachment.Kind.IMAGE),

	MP4("video/mp4", Attachment.Kind.VIDEO),

	WEBM("video/webm", Attachment.Kind.VIDEO);

	// 画像は 10MB、動画は 100MB まで
	static final long MAX_IMAGE_BYTES = 10L * 1024 * 1024;

	static final long MAX_VIDEO_BYTES = 100L * 1024 * 1024;

	// 形式を確かめるのに読む先頭のバイト数
	static final int HEAD_BYTES = 16;

	// MP4：5〜8 バイト目が "ftyp"
	private static final byte[] FTYP = { 'f', 't', 'y', 'p' };

	// WebM（Matroska）：先頭が EBML の印
	private static final byte[] EBML = { 0x1A, 0x45, (byte) 0xDF, (byte) 0xA3 };

	private final String contentType;

	private final Attachment.Kind kind;

	AttachmentFormat(String contentType, Attachment.Kind kind) {
		this.contentType = contentType;
		this.kind = kind;
	}

	static Optional<AttachmentFormat> of(String contentType) {
		return Arrays.stream(values()).filter((f) -> f.contentType.equals(contentType)).findFirst();
	}

	String contentType() {
		return this.contentType;
	}

	Attachment.Kind kind() {
		return this.kind;
	}

	long maxBytes() {
		return (this.kind == Attachment.Kind.IMAGE) ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
	}

	// ファイルの先頭がこの形式か。拡張子を変えた HTML・SVG などを見分ける
	boolean matches(byte[] head) {
		return switch (this) {
			case JPEG -> ImageFormat.detect(head).filter((f) -> f == ImageFormat.JPEG).isPresent();
			case PNG -> ImageFormat.detect(head).filter((f) -> f == ImageFormat.PNG).isPresent();
			case GIF -> ImageFormat.detect(head).filter((f) -> f == ImageFormat.GIF).isPresent();
			case WEBP -> ImageFormat.detect(head).filter((f) -> f == ImageFormat.WEBP).isPresent();
			case MP4 -> startsWith(head, 4, FTYP);
			case WEBM -> startsWith(head, 0, EBML);
		};
	}

	private static boolean startsWith(byte[] data, int offset, byte[] magic) {
		return data.length >= offset + magic.length
				&& Arrays.equals(data, offset, offset + magic.length, magic, 0, magic.length);
	}

}
