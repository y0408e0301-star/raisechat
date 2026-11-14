package com.example.raisechat.storage;

import java.util.Arrays;
import java.util.Optional;

// 画像の形式（アバターは FN-02 4 章、添付は FN-09 4 章）。拡張子ではなく、ファイルの先頭のバイト（マジックナンバー）で決める
public enum ImageFormat {

	JPEG("image/jpeg"),

	PNG("image/png"),

	GIF("image/gif"),

	WEBP("image/webp");

	private static final byte[] JPEG_MAGIC = { (byte) 0xFF, (byte) 0xD8, (byte) 0xFF };

	private static final byte[] PNG_MAGIC = { (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A };

	private static final byte[] GIF87A = { 'G', 'I', 'F', '8', '7', 'a' };

	private static final byte[] GIF89A = { 'G', 'I', 'F', '8', '9', 'a' };

	private static final byte[] RIFF = { 'R', 'I', 'F', 'F' };

	private static final byte[] WEBP_MAGIC = { 'W', 'E', 'B', 'P' };

	private final String contentType;

	ImageFormat(String contentType) {
		this.contentType = contentType;
	}

	public String contentType() {
		return this.contentType;
	}

	// WebP は先頭が "RIFF"、9〜12 バイト目が "WEBP"
	public static Optional<ImageFormat> detect(byte[] data) {
		if (startsWith(data, 0, JPEG_MAGIC)) {
			return Optional.of(JPEG);
		}
		if (startsWith(data, 0, PNG_MAGIC)) {
			return Optional.of(PNG);
		}
		if (startsWith(data, 0, GIF87A) || startsWith(data, 0, GIF89A)) {
			return Optional.of(GIF);
		}
		if (startsWith(data, 0, RIFF) && startsWith(data, 8, WEBP_MAGIC)) {
			return Optional.of(WEBP);
		}
		return Optional.empty();
	}

	private static boolean startsWith(byte[] data, int offset, byte[] magic) {
		return data.length >= offset + magic.length
				&& Arrays.equals(data, offset, offset + magic.length, magic, 0, magic.length);
	}

}
