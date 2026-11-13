package com.example.raisechat.workspace;

import java.time.Clock;
import java.time.Duration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

// 作ってから 30 日たった招待リンク（どれも期限切れか取り消し済み）を 1 日 1 回まとめて消す（BR-14、機能定義書 FN-04 5 章の 4）
@Component
class InviteCleanup {

	// 作ってから消すまで
	static final Duration RETENTION = Duration.ofDays(30);

	private static final Logger log = LoggerFactory.getLogger(InviteCleanup.class);

	private final InviteRepository invites;

	private final Clock clock;

	InviteCleanup(InviteRepository invites, Clock clock) {
		this.invites = invites;
		this.clock = clock;
	}

	// 毎日 4:30（日本時間。データ設計書 9 章）
	@Scheduled(cron = "0 30 4 * * *", zone = "Asia/Tokyo")
	@Transactional
	public void deleteOld() {
		int deleted = this.invites.deleteCreatedBefore(this.clock.instant().minus(RETENTION));
		log.atInfo().addKeyValue("deleted.count", deleted).log("作ってから 30 日たった招待リンクを {} 件消しました", deleted);
	}

}
