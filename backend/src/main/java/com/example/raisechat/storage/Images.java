package com.example.raisechat.storage;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.Iterator;
import java.util.Optional;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.IntBinaryOperator;

import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

// 画像の読み込みと縮小（技術スタック定義書 5.5）。JPEG・PNG・GIF は Java の標準で、WebP は TwelveMonkeys ImageIO で読む。
// 縮小は Java の標準（java.awt）で行う
public final class Images {

	// 読む画像の画素数の上限（4,000 万画素。6,000×6,000px 程度まで）。小さなファイルに圧縮された巨大な画像を
	// 読み込んで、メモリを使い切らないよう、幅・高さだけを先に読んで確かめる
	static final long MAX_PIXELS = 40_000_000L;

	// 同時に読む画像の数。4,000 万画素の画像をそのまま読むと 1 枚で 160MB ほど使うので、同時に送られても
	// API のメモリ（ヒープ）を使い切らないよう絞る。待ちきれなければ 500（M-49）にする
	static final int CONCURRENT_READS = 2;

	static final Duration READ_WAIT = Duration.ofSeconds(30);

	private static final Semaphore READING = new Semaphore(CONCURRENT_READS, true);

	private Images() {
	}

	// 画素をすべて読む（縮めずに使うとき）
	public static Optional<BufferedImage> read(byte[] data) {
		return decode(data, (width, height) -> 1).map(Decoded::image);
	}

	// アバター（真ん中を正方形に切り取る）のために読む。短い辺が minShortSide の 2 倍を下回らない範囲で、画素を間引いて読む
	// （縮めた後のきれいさは変わらず、読むときのメモリが減る）。間引けない読み込みの部品では、すべて読む
	public static Optional<BufferedImage> read(byte[] data, int minShortSide) {
		return decode(data, (width, height) -> Math.max(1, Math.min(width, height) / (minShortSide * 2)))
			.map(Decoded::image);
	}

	// 縮小した画像（長い辺を maxLongSide までにする。FN-09 5 章の 4）のために読む。長い辺が maxLongSide の 2 倍を
	// 下回らない範囲で間引いて読み、元の幅・高さも返す
	public static Optional<Decoded> readForThumbnail(byte[] data, int maxLongSide) {
		return decode(data, (width, height) -> Math.max(1, Math.max(width, height) / (maxLongSide * 2)));
	}

	// 読めない画像・大きすぎる画像は空を返す。アニメーションする画像は最初のコマを読む。step は幅・高さから間引く間隔を決める
	private static Optional<Decoded> decode(byte[] data, IntBinaryOperator step) {
		acquire();
		try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(data))) {
			Iterator<ImageReader> readers = ImageIO.getImageReaders(in);
			if (!readers.hasNext()) {
				return Optional.empty();
			}
			ImageReader reader = readers.next();
			try {
				reader.setInput(in, true, true);
				int width = reader.getWidth(0);
				int height = reader.getHeight(0);
				if ((long) width * height > MAX_PIXELS) {
					return Optional.empty();
				}
				ImageReadParam param = reader.getDefaultReadParam();
				int every = step.applyAsInt(width, height);
				if (every > 1) {
					param.setSourceSubsampling(every, every, 0, 0);
				}
				return Optional.ofNullable(reader.read(0, param)).map((image) -> new Decoded(image, width, height));
			}
			finally {
				reader.dispose();
			}
		}
		// 壊れたファイルでは、読み込みの部品によって IOException 以外の例外も出る
		catch (IOException | RuntimeException ex) {
			return Optional.empty();
		}
		finally {
			READING.release();
		}
	}

	private static void acquire() {
		try {
			if (!READING.tryAcquire(READ_WAIT.toMillis(), TimeUnit.MILLISECONDS)) {
				throw new IllegalStateException("画像の読み込みが混んでいて、待ちきれませんでした");
			}
		}
		catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException("画像の読み込みを待つ間に止められました", ex);
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

	// 縦横の比を変えずに、長い辺を maxLongSide にする（FN-09 5 章の 4）。透過があれば残す
	public static BufferedImage fit(BufferedImage image, int maxLongSide) {
		int type = image.getColorModel().hasAlpha() ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB;
		double ratio = (double) maxLongSide / Math.max(image.getWidth(), image.getHeight());
		int width = Math.max(1, (int) Math.round(image.getWidth() * ratio));
		int height = Math.max(1, (int) Math.round(image.getHeight() * ratio));
		BufferedImage current = image;
		// 一度に大きく縮めると粗くなるので、半分ずつ縮めてから最後に決めた大きさにする
		while (current.getWidth() / 2 >= width && current.getHeight() / 2 >= height) {
			current = scale(current, current.getWidth() / 2, current.getHeight() / 2, type);
		}
		return scale(current, width, height, type);
	}

	public static boolean hasAlpha(BufferedImage image) {
		return image.getColorModel().hasAlpha();
	}

	public static byte[] png(BufferedImage image) {
		return write(image, "png");
	}

	// 透過のない画像だけ（JPEG は透過を持てない）。透過があれば png を使う
	public static byte[] jpeg(BufferedImage image) {
		BufferedImage rgb = image;
		if (image.getType() != BufferedImage.TYPE_INT_RGB) {
			rgb = scale(image, image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_RGB);
		}
		return write(rgb, "jpeg");
	}

	private static byte[] write(BufferedImage image, String format) {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		try {
			// 書き出す部品がない形の画像なら false（ここで作る ARGB・RGB の画像では起きない）
			if (!ImageIO.write(image, format, out)) {
				throw new IllegalStateException(format + " に書き出せない画像です");
			}
		}
		catch (IOException ex) {
			// 書き出し先はメモリなので、起きない
			throw new UncheckedIOException(ex);
		}
		return out.toByteArray();
	}

	private static BufferedImage scale(BufferedImage image, int side) {
		return scale(image, side, side, BufferedImage.TYPE_INT_ARGB);
	}

	private static BufferedImage scale(BufferedImage image, int width, int height, int type) {
		BufferedImage scaled = new BufferedImage(width, height, type);
		Graphics2D g = scaled.createGraphics();
		try {
			g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
			g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
			g.drawImage(image, 0, 0, width, height, null);
		}
		finally {
			g.dispose();
		}
		return scaled;
	}

	// 読んだ画像（間引いていることがある）と、元の画像の幅・高さ
	public record Decoded(BufferedImage image, int width, int height) {
	}

}
