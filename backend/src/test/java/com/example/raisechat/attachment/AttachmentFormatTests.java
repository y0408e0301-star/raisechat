package com.example.raisechat.attachment;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;

import com.example.raisechat.storage.TestImages;

// 添付できる形式と、ファイルの先頭のバイトでの確かめ（FN-09 4 章・5 章の 3）
class AttachmentFormatTests {

	@Test
	void 決めた6つの形式だけ() {
		assertThat(AttachmentFormat.of("image/jpeg")).hasValue(AttachmentFormat.JPEG);
		assertThat(AttachmentFormat.of("video/webm")).hasValue(AttachmentFormat.WEBM);
		assertThat(AttachmentFormat.of("image/svg+xml")).isEmpty();
		assertThat(AttachmentFormat.of("IMAGE/PNG")).isEmpty();
	}

	@Test
	void 画像は10MB動画は100MBまで() {
		assertThat(AttachmentFormat.GIF.maxBytes()).isEqualTo(10_485_760L);
		assertThat(AttachmentFormat.MP4.maxBytes()).isEqualTo(104_857_600L);
	}

	@Test
	void 先頭のバイトが申告した形式か確かめる() {
		assertThat(AttachmentFormat.PNG.matches(TestImages.png(1, 1))).isTrue();
		assertThat(AttachmentFormat.JPEG.matches(TestImages.png(1, 1))).isFalse();
		assertThat(AttachmentFormat.WEBP.matches(TestImages.webp(true))).isTrue();
		assertThat(AttachmentFormat.MP4.matches(new byte[] { 0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'm', 'p', '4', '2' }))
			.isTrue();
		assertThat(AttachmentFormat.WEBM.matches(new byte[] { 0x1A, 0x45, (byte) 0xDF, (byte) 0xA3, 1 })).isTrue();
		assertThat(AttachmentFormat.MP4.matches(new byte[] { 0x1A, 0x45, (byte) 0xDF, (byte) 0xA3, 1 })).isFalse();
		byte[] html = "<html></html>".getBytes(StandardCharsets.UTF_8);
		for (AttachmentFormat format : AttachmentFormat.values()) {
			assertThat(format.matches(html)).as(format.name()).isFalse();
		}
		assertThat(AttachmentFormat.MP4.matches(new byte[3])).isFalse();
	}

}
