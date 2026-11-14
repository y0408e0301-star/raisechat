package com.example.raisechat.profile;

import java.awt.image.BufferedImage;
import java.time.Clock;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.emoji.Emojis;
import com.example.raisechat.storage.FileStorage;
import com.example.raisechat.storage.ImageFormat;
import com.example.raisechat.storage.Images;
import com.example.raisechat.storage.StorageDeleter;
import com.example.raisechat.user.DisplayNames;
import com.example.raisechat.user.User;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.user.UserSummaries;
import com.example.raisechat.user.UserSummary;

// プロフィール（機能定義書 FN-02）。プロフィールの変更はリアルタイムで送らない（5 章の 5）
@Service
class ProfileService {

	// アバターの大きさ（PF-2）
	static final int AVATAR_SIZE = 256;

	// 送れるアバターのファイルの大きさ（4 章。5MB）。multipart の上限（application.properties）と同じ
	static final long AVATAR_MAX_BYTES = 5L * 1024 * 1024;

	private static final Set<ImageFormat> AVATAR_FORMATS = EnumSet.of(ImageFormat.JPEG, ImageFormat.PNG,
			ImageFormat.WEBP);

	private final UserRepository users;

	private final UserSummaries userSummaries;

	private final Emojis emojis;

	private final FileStorage storage;

	private final StorageDeleter deleter;

	private final TransactionTemplate transaction;

	private final Clock clock;

	ProfileService(UserRepository users, UserSummaries userSummaries, Emojis emojis, FileStorage storage,
			StorageDeleter deleter, TransactionTemplate transaction, Clock clock) {
		this.users = users;
		this.userSummaries = userSummaries;
		this.emojis = emojis;
		this.storage = storage;
		this.deleter = deleter;
		this.transaction = transaction;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	MyProfile get(long me) {
		User user = this.users.findById(me).orElseThrow();
		Instant now = this.clock.instant();
		return MyProfile.of(this.userSummaries.of(user, now), user.currentStatusExpiresAt(now));
	}

	// 表示名とステータスを変える（PF-1・PF-4〜PF-6）。絵文字も文も空なら、消す時刻もなくす（5 章の 3）
	@Transactional
	UserSummary update(long me, @Nullable String displayName, @Nullable String statusEmoji, @Nullable String statusText,
			@Nullable Instant statusExpiresAt) {
		Instant now = this.clock.instant();
		String name = DisplayNames.valid(displayName);
		String emoji = ProfileInputs.statusEmoji(statusEmoji, this.emojis);
		String text = ProfileInputs.statusText(statusText);
		Instant expiresAt = ProfileInputs.statusExpiresAt(statusExpiresAt, now);
		User user = this.users.findById(me).orElseThrow();
		user.changeDisplayName(name, now);
		user.changeStatus(emoji, text, expiresAt, now);
		return this.userSummaries.of(user, now);
	}

	// アバターを替える（PF-2、3.1）。真ん中を正方形に切り取り 256×256px の PNG にして S3 に置き、
	// コミットの後で前のアバターを消す（BR-12）。元の画像は保存しない（5 章の 1）
	UserSummary changeAvatar(long me, byte[] data) {
		if (data.length > AVATAR_MAX_BYTES) {
			throw new ApiException(ErrorCode.AVATAR_TOO_LARGE, "file");
		}
		if (ImageFormat.detect(data).filter(AVATAR_FORMATS::contains).isEmpty()) {
			throw new ApiException(ErrorCode.AVATAR_INVALID, "file");
		}
		BufferedImage image = Images.read(data, AVATAR_SIZE)
			.orElseThrow(() -> new ApiException(ErrorCode.AVATAR_INVALID, "file"));
		String key = "avatars/" + UUID.randomUUID() + ".png";
		byte[] png = Images.png(Images.squareCrop(image, AVATAR_SIZE));
		Changed changed = null;
		try {
			this.storage.put(key, ImageFormat.PNG.contentType(), png);
			changed = replaceAvatar(me, key);
		}
		finally {
			// データベースに記録できなかったので、置いたファイルは使われない。S3 に置くのに失敗したときも、
			// 置けたのに応答だけ届かなかったことがあるので消す（ないファイルを消しても失敗にはならない）
			if (changed == null) {
				this.deleter.deleteOrRecord(List.of(key));
			}
		}
		deletePrevious(changed);
		return changed.user();
	}

	// アバターを外す（PF-3）
	UserSummary removeAvatar(long me) {
		Changed changed = replaceAvatar(me, null);
		deletePrevious(changed);
		return changed.user();
	}

	// 同じ人が同時に替えても、前のアバターを取りこぼさないよう行をロックする
	private Changed replaceAvatar(long me, @Nullable String key) {
		Changed changed = this.transaction.execute((status) -> {
			Instant now = this.clock.instant();
			User user = this.users.findByIdForUpdate(me).orElseThrow();
			String previous = user.changeAvatar(key, now);
			return new Changed(this.userSummaries.of(user, now), previous);
		});
		if (changed == null) {
			throw new IllegalStateException("トランザクションの結果がありません");
		}
		return changed;
	}

	private void deletePrevious(Changed changed) {
		String previous = changed.previousKey();
		if (previous != null) {
			this.deleter.deleteOrRecord(List.of(previous));
		}
	}

	private record Changed(UserSummary user, @Nullable String previousKey) {
	}

}
