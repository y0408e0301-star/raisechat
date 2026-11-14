package com.example.raisechat.storage;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.CRC32;

import javax.imageio.ImageIO;

// テストで使う画像。真ん中の正方形が赤、その外側が青なので、真ん中を切り取ると全体が赤になる
public final class TestImages {

	private TestImages() {
	}

	public static byte[] png(int width, int height) {
		return write(centerSquare(width, height, BufferedImage.TYPE_INT_ARGB), "png");
	}

	public static byte[] jpeg(int width, int height) {
		return write(centerSquare(width, height, BufferedImage.TYPE_INT_RGB), "jpeg");
	}

	public static byte[] gif(int width, int height) {
		return write(centerSquare(width, height, BufferedImage.TYPE_INT_RGB), "gif");
	}

	// 300×200px の WebP（ffmpeg で作ったもの。可逆と非可逆）。Java では WebP を書けないので、ファイルを使う
	public static byte[] webp(boolean lossless) {
		String name = lossless ? "/images/wide.webp" : "/images/wide-lossy.webp";
		try (InputStream in = TestImages.class.getResourceAsStream(name)) {
			if (in == null) {
				throw new IllegalStateException(name + " がありません");
			}
			return in.readAllBytes();
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	public static BufferedImage read(byte[] data) {
		try {
			BufferedImage image = ImageIO.read(new ByteArrayInputStream(data));
			if (image == null) {
				throw new IllegalStateException("画像を読めません");
			}
			return image;
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	// 画像の後ろに 0 を足して、ちょうど size バイトにする（PNG は IEND の後ろを読まない）
	public static byte[] paddedTo(byte[] image, int size) {
		return Arrays.copyOf(image, size);
	}

	// 幅・高さだけを書いた PNG（中身の画素はない）。画素数の上限で、中身を読む前に断るかを確かめる
	public static byte[] pngHeaderOnly(int width, int height) {
		ByteBuffer ihdr = ByteBuffer.allocate(13).putInt(width).putInt(height).put(new byte[] { 8, 6, 0, 0, 0 });
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		out.writeBytes(new byte[] { (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A });
		chunk(out, "IHDR", ihdr.array());
		chunk(out, "IEND", new byte[0]);
		return out.toByteArray();
	}

	private static void chunk(ByteArrayOutputStream out, String type, byte[] data) {
		byte[] typeBytes = type.getBytes(StandardCharsets.US_ASCII);
		CRC32 crc = new CRC32();
		crc.update(typeBytes);
		crc.update(data);
		out.writeBytes(ByteBuffer.allocate(4).putInt(data.length).array());
		out.writeBytes(typeBytes);
		out.writeBytes(data);
		out.writeBytes(ByteBuffer.allocate(4).putInt((int) crc.getValue()).array());
	}

	private static BufferedImage centerSquare(int width, int height, int type) {
		BufferedImage image = new BufferedImage(width, height, type);
		Graphics2D g = image.createGraphics();
		g.setColor(Color.BLUE);
		g.fillRect(0, 0, width, height);
		int side = Math.min(width, height);
		g.setColor(Color.RED);
		g.fillRect((width - side) / 2, (height - side) / 2, side, side);
		g.dispose();
		return image;
	}

	private static byte[] write(BufferedImage image, String format) {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		try {
			ImageIO.write(image, format, out);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		return out.toByteArray();
	}

}
