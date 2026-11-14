package com.example.raisechat.attachment;

import java.time.Clock;
import java.time.Duration;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.example.raisechat.storage.StorageDeleter;

// アップロードしたが送らなかった添付を 1 日 1 回まとめて消す（AT-11、BR-13）。行を消し、コミットの後で S3 のファイルを消す
@Component
class AttachmentCleanup {

	// アップロードしてから消すまで
	static final Duration RETENTION = Duration.ofHours(24);

	private static final Logger log = LoggerFactory.getLogger(AttachmentCleanup.class);

	private final AttachmentRepository attachments;

	private final StorageDeleter deleter;

	private final Clock clock;

	AttachmentCleanup(AttachmentRepository attachments, StorageDeleter deleter, Clock clock) {
		this.attachments = attachments;
		this.deleter = deleter;
		this.clock = clock;
	}

	// 毎日 4:30（日本時間。データ設計書 9 章）
	@Scheduled(cron = "0 30 4 * * *", zone = "Asia/Tokyo")
	@Transactional
	public void deleteUnsent() {
		List<Attachment> unsent = this.attachments.findUnsentBefore(this.clock.instant().minus(RETENTION));
		this.attachments.deleteAll(unsent);
		this.deleter.deleteAfterCommit(unsent.stream().flatMap((a) -> a.storageKeys().stream()).toList());
		log.atInfo().addKeyValue("deleted.count", unsent.size()).log("送らなかった添付を {} 件消しました", unsent.size());
	}

}
