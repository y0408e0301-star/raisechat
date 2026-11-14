package com.example.raisechat.storage;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

// 画像の形式の判定・読み込み・切り取りと縮小（技術スタック定義書 5.5、FN-02 PF-2）
class ImagesTests {

	@Test
	void 形式は先頭のバイトで決める() {
		assertThat(ImageFormat.detect(TestImages.jpeg(10, 10))).hasValue(ImageFormat.JPEG);
		assertThat(ImageFormat.detect(TestImages.png(10, 10))).hasValue(ImageFormat.PNG);
		assertThat(ImageFormat.detect(TestImages.gif(10, 10))).hasValue(ImageFormat.GIF);
		assertThat(ImageFormat.detect(TestImages.webp(true))).hasValue(ImageFormat.WEBP);
		assertThat(ImageFormat.detect("<svg xmlns=\"http://www.w3.org/2000/svg\"/>".getBytes(StandardCharsets.UTF_8)))
			.isEmpty();
		assertThat(ImageFormat.detect(new byte[0])).isEmpty();
		// 先頭が RIFF でも、WebP でなければ（WAV など）画像ではない
		assertThat(ImageFormat.detect("RIFF\0\0\0\0WAVEfmt ".getBytes(StandardCharsets.US_ASCII))).isEmpty();
	}

	@Test
	void JPEGとPNGとGIFを読める() {
		assertThat(Images.read(TestImages.jpeg(30, 20))).hasValueSatisfying((image) -> size(image, 30, 20));
		assertThat(Images.read(TestImages.png(30, 20))).hasValueSatisfying((image) -> size(image, 30, 20));
		assertThat(Images.read(TestImages.gif(30, 20))).hasValueSatisfying((image) -> size(image, 30, 20));
	}

	// Java の標準では読めないので、TwelveMonkeys ImageIO（imageio-webp）で読む
	@ParameterizedTest
	@ValueSource(booleans = { true, false })
	void WebPを読める(boolean lossless) {
		assertThat(Images.read(TestImages.webp(lossless))).hasValueSatisfying((image) -> size(image, 300, 200));
	}

	@Test
	void 壊れた画像は読めない() {
		byte[] png = TestImages.png(30, 20);
		assertThat(Images.read(Arrays.copyOf(png, 40))).isEmpty();
		assertThat(Images.read("not an image".getBytes(StandardCharsets.UTF_8))).isEmpty();
		assertThat(Images.read(new byte[0])).isEmpty();
	}

	// 4,000 万画素を超える画像は、画素を読む前に断る（小さなファイルに圧縮された巨大な画像でメモリを使い切らないため）
	@Test
	void 画素が多すぎる画像は読まない() {
		assertThat(Images.read(TestImages.pngHeaderOnly(8000, 5001))).isEmpty();
	}

	@Test
	void 横長の画像は真ん中を正方形に切り取って縮める() {
		BufferedImage avatar = Images.squareCrop(TestImages.read(TestImages.png(600, 300)), 256);
		size(avatar, 256, 256);
		allRed(avatar);
	}

	@Test
	void 縦長の画像も真ん中を正方形に切り取る() {
		BufferedImage avatar = Images.squareCrop(TestImages.read(TestImages.jpeg(300, 1200)), 256);
		size(avatar, 256, 256);
		allRed(avatar);
	}

	@Test
	void WebPも真ん中を正方形に切り取る() {
		BufferedImage avatar = Images.squareCrop(Images.read(TestImages.webp(true)).orElseThrow(), 256);
		size(avatar, 256, 256);
		allRed(avatar);
	}

	@Test
	void 小さな画像は256pxに広げる() {
		BufferedImage avatar = Images.squareCrop(TestImages.read(TestImages.png(100, 40)), 256);
		size(avatar, 256, 256);
		allRed(avatar);
	}

	@Test
	void PNGに書き出す() throws IOException {
		byte[] png = Images.png(Images.squareCrop(TestImages.read(TestImages.png(10, 10)), 16));
		assertThat(ImageFormat.detect(png)).hasValue(ImageFormat.PNG);
		BufferedImage read = ImageIO.read(new ByteArrayInputStream(png));
		size(read, 16, 16);
	}

	private static void size(BufferedImage image, int width, int height) {
		assertThat(image.getWidth()).isEqualTo(width);
		assertThat(image.getHeight()).isEqualTo(height);
	}

	// 四隅と真ん中が赤（切り取った外側の青が入っていない）。JPEG と、色を間引いて作った WebP は、赤と青の境目で色が少しにじむので、
	// 青が半分より少なければよい（外側を切り取れていなければ、隅は青 255 になる）
	private static void allRed(BufferedImage image) {
		int last = image.getWidth() - 1;
		for (int[] point : new int[][] { { 0, 0 }, { last, 0 }, { 0, last }, { last, last }, { last / 2, last / 2 } }) {
			Color color = new Color(image.getRGB(point[0], point[1]));
			assertThat(color.getRed()).as("赤 %s", Arrays.toString(point)).isGreaterThan(200);
			assertThat(color.getBlue()).as("青 %s", Arrays.toString(point)).isLessThan(128);
		}
	}

}
