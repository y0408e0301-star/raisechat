package com.example.raisechat.storage;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.image.BufferedImage;

import org.junit.jupiter.api.Test;

// 添付の縮小した画像（FN-09 5 章の 4）と、ダウンロードの名前（5 章の 6）
class ThumbnailTests {

	// 4,000×2,000px を、長い辺が 1,600px（800px の 2 倍）を下回らない範囲で 2 つに 1 つずつ読み、元の大きさも返す
	@Test
	void 縮小のために間引いて読み元の幅と高さを返す() {
		assertThat(Images.readForThumbnail(TestImages.jpeg(4000, 2000), 800)).hasValueSatisfying((decoded) -> {
			assertThat(decoded.width()).isEqualTo(4000);
			assertThat(decoded.height()).isEqualTo(2000);
			assertThat(decoded.image().getWidth()).isEqualTo(2000);
		});
	}

	@Test
	void 縦横の比を変えずに長い辺を800pxにする() {
		BufferedImage wide = Images.fit(TestImages.read(TestImages.jpeg(3000, 1000)), 800);
		assertThat(wide.getWidth()).isEqualTo(800);
		assertThat(wide.getHeight()).isEqualTo(267);
		BufferedImage tall = Images.fit(TestImages.read(TestImages.png(500, 1500)), 800);
		assertThat(tall.getWidth()).isEqualTo(267);
		assertThat(tall.getHeight()).isEqualTo(800);
	}

	@Test
	void 透過は残しJPEGには透過なしで書き出す() {
		BufferedImage alpha = Images.fit(TestImages.read(TestImages.png(1600, 1600)), 800);
		assertThat(Images.hasAlpha(alpha)).isTrue();
		BufferedImage opaque = Images.fit(TestImages.read(TestImages.jpeg(1600, 1600)), 800);
		assertThat(Images.hasAlpha(opaque)).isFalse();
		assertThat(ImageFormat.detect(Images.jpeg(opaque))).hasValue(ImageFormat.JPEG);
		// 透過のある画像を JPEG にしても書き出せる（透過はなくなる）
		assertThat(ImageFormat.detect(Images.jpeg(alpha))).hasValue(ImageFormat.JPEG);
	}

	// RFC 6266：日本語の名前は filename* に UTF-8 で、filename には ASCII の代わりの名前を入れる
	@Test
	void ダウンロードの名前は日本語も崩れないように書く() {
		assertThat(FileStorage.attachment("夏 の\"写真\".png")).isEqualTo(
				"attachment; filename=\"_ _____.png\"; filename*=UTF-8''%E5%A4%8F%20%E3%81%AE%22%E5%86%99%E7%9C%9F%22.png");
	}

}
