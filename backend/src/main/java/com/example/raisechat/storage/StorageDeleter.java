package com.example.raisechat.storage;

import java.time.Clock;
import java.util.Collection;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// S3 のファイルを消す。消せなかったものは storage_deletions に記録し、1 日 1 回消し直す（データ設計書 BR-12）。
// データベースの行は先に消してあるので、ここで失敗しても利用者にはエラーを返さない
@Component
public class StorageDeleter {

	private static final Logger log = LoggerFactory.getLogger(StorageDeleter.class);

	private final FileStorage storage;

	private final StorageDeletionRepository deletions;

	private final Clock clock;

	StorageDeleter(FileStorage storage, StorageDeletionRepository deletions, Clock clock) {
		this.storage = storage;
		this.deletions = deletions;
		this.clock = clock;
	}

	public void deleteOrRecord(Collection<String> keys) {
		for (String key : keys) {
			try {
				this.storage.delete(key);
			}
			catch (RuntimeException ex) {
				log.atWarn().addKeyValue("storage.key", key).setCause(ex).log("S3 のファイル {} を消せなかったので、あとで消し直します", key);
				record(key);
			}
		}
	}

	// 同じキーを同時に記録したときは、一意の制約で片方が失敗するが、記録は 1 つあれば足りる
	private void record(String key) {
		try {
			if (!this.deletions.existsByStorageKey(key)) {
				this.deletions.save(new StorageDeletion(key, this.clock.instant()));
			}
		}
		catch (DataIntegrityViolationException ex) {
			log.atDebug().addKeyValue("storage.key", key).log("S3 から消せなかったファイル {} はもう記録してあります", key);
		}
		catch (RuntimeException ex) {
			// データベースの行はコミットしてあるので、ここでも利用者にはエラーを返さない。ファイルは S3 に残る
			log.atError().addKeyValue("storage.key", key).setCause(ex).log("S3 から消せなかったファイル {} を記録できませんでした", key);
		}
	}

	// 毎日 4:30（日本時間。データ設計書 9 章）。使う人が少ない時間に動かす
	@Scheduled(cron = "0 30 4 * * *", zone = "Asia/Tokyo")
	public void retry() {
		int deleted = 0;
		for (StorageDeletion deletion : this.deletions.findAll()) {
			try {
				this.storage.delete(deletion.getStorageKey());
				this.deletions.delete(deletion);
				deleted++;
			}
			catch (RuntimeException ex) {
				log.atWarn()
					.addKeyValue("storage.key", deletion.getStorageKey())
					.setCause(ex)
					.log("S3 のファイル {} をまた消せませんでした", deletion.getStorageKey());
			}
		}
		log.atInfo().addKeyValue("deleted.count", deleted).log("S3 から消せていなかったファイルを {} 件消しました", deleted);
	}

}
