package com.example.raisechat.storage;

import java.time.Clock;
import java.util.Collection;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

// S3 のファイルを消す。消せなかったものは storage_deletions に記録し、1 日 1 回消し直す（データ設計書 BR-12）。
// データベースの行は先に消してあるので、ここで失敗しても利用者にはエラーを返さない
@Component
public class StorageDeleter {

	private static final Logger log = LoggerFactory.getLogger(StorageDeleter.class);

	private final FileStorage storage;

	private final StorageDeletionRepository deletions;

	private final Clock clock;

	// 記録は新しいトランザクションで行う。コミットの後（afterCommit）では、もとのトランザクションに書いてもコミットされないため
	private final TransactionTemplate newTransaction;

	@Autowired
	StorageDeleter(FileStorage storage, StorageDeletionRepository deletions, Clock clock,
			PlatformTransactionManager transactionManager) {
		this(storage, deletions, clock, requiresNew(transactionManager));
	}

	StorageDeleter(FileStorage storage, StorageDeletionRepository deletions, Clock clock,
			TransactionTemplate newTransaction) {
		this.storage = storage;
		this.deletions = deletions;
		this.clock = clock;
		this.newTransaction = newTransaction;
	}

	private static TransactionTemplate requiresNew(PlatformTransactionManager transactionManager) {
		TransactionTemplate template = new TransactionTemplate(transactionManager);
		template.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
		return template;
	}

	// トランザクションの中で呼ばれたら、コミットの後で消す（BR-12。ロールバックしたら消さない）。外なら、すぐ消す
	public void deleteAfterCommit(Collection<String> keys) {
		if (keys.isEmpty()) {
			return;
		}
		List<String> copy = List.copyOf(keys);
		if (!TransactionSynchronizationManager.isSynchronizationActive()) {
			deleteOrRecord(copy);
			return;
		}
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
			@Override
			public void afterCommit() {
				deleteOrRecord(copy);
			}
		});
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
			this.newTransaction.executeWithoutResult((status) -> {
				if (!this.deletions.existsByStorageKey(key)) {
					this.deletions.save(new StorageDeletion(key, this.clock.instant()));
				}
			});
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
