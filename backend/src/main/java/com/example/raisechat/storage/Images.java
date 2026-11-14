package com.example.raisechat.storage;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Iterator;
import java.util.Optional;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

// 画像の読み込みと縮小（技術スタック定義書 5.5）。JPEG・PNG・GIF は Java の標準で、WebP は TwelveMonkeys ImageIO で読む。
// 縮小は Java の標準（java.awt）で行う
public final class Images {

	// 読む画像の画素数の上限（4,000 万画素。6,000×6,000px 程度まで）。小さなファイルに圧縮された巨大な画像を
	// 読み込んで、メモリを使い切らないよう、幅・高さだけを先に読んで確かめる
	static final long MAX_PIXELS = 40_000_000L;

	private Images() {
	}

	// 読めない画像・大きすぎる画像は空を返す。アニメーションする画像は最初のコマを読む
	public static Optional<BufferedImage> read(byte[] data) {
		try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(data))) {
			Iterator<ImageReader> readers = ImageIO.getImageReaders(in);
			if (!readers.hasNext()) {
				return Optional.empty();
			}
			ImageReader reader = readers.next();
			try {
				reader.setInput(in, true, true);
				if ((long) reader.getWidth(0) * reader.getHeight(0) > MAX_PIXELS) {
					return Optional.empty();
				}
				return Optional.ofNullable(reader.read(0));
			}
			finally {
				reader.dispose();
			}
		}
		// 壊れたファイルでは、読み込みの部品によって IOException 以外の例外も出る
		catch (IOException | RuntimeException ex) {
			return Optional.empty();
		}
	}

	// 真ん中を正方形に切り取り、size×size px にする（FN-02 PF-2）。透過は残す
	public static BufferedImage squareCrop(BufferedImage image, int size) {
		int side = Math.min(image.getWidth(), image.getHeight());
		BufferedImage current = image.getSubimage((image.getWidth() - side) / 2, (image.getHeight() - side) / 2, side,
				side);
		// 一度に大きく縮めると粗くなるので、半分ずつ縮めてから最後に size にする
		int currentSide = side;
		while (currentSide / 2 >= size) {
			currentSide /= 2;
			current = scale(current, currentSide);
		}
		return scale(current, size);
	}

	public static byte[] png(BufferedImage image) {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		try {
			ImageIO.write(image, "png", out);
		}
		catch (IOException ex) {
			// 書き出し先はメモリなので、起きない
			throw new UncheckedIOException(ex);
		}
		return out.toByteArray();
	}

	private static BufferedImage scale(BufferedImage image, int side) {
		BufferedImage scaled = new BufferedImage(side, side, BufferedImage.TYPE_INT_ARGB);
		Graphics2D g = scaled.createGraphics();
		try {
			g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
			g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
			g.drawImage(image, 0, 0, side, side, null);
		}
		finally {
			g.dispose();
		}
		return scaled;
	}

}
