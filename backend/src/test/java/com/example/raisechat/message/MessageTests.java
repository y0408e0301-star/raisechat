package com.example.raisechat.message;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;

// メッセージの状態の変わり方（MS-9・MS-11、BR-7・BR-8）
class MessageTests {

	private static final Instant NOW = Instant.parse("2026-11-11T03:00:00Z");

	@Test
	void 編集すると本文と編集日時を変える() {
		Message message = new Message(1, 2, UUID.randomUUID(), "前", NOW);
		message.edit("後", NOW.plusSeconds(60));
		assertThat(message.getBody()).isEqualTo("後");
		assertThat(message.getEditedAt()).isEqualTo(NOW.plusSeconds(60));
	}

	@Test
	void 返信を足すと件数と最後の返信の日時を変える() {
		Message message = new Message(1, 2, UUID.randomUUID(), "親", NOW);
		message.replyAdded(NOW.plusSeconds(10));
		message.replyAdded(NOW.plusSeconds(20));
		assertThat(message.getReplyCount()).isEqualTo(2);
		assertThat(message.getLastReplyAt()).isEqualTo(NOW.plusSeconds(20));
	}

	@Test
	void 削除されましたにすると本文を空にする() {
		Message message = new Message(1, 2, UUID.randomUUID(), "親", NOW);
		message.markDeleted(NOW);
		assertThat(message.getBody()).isEmpty();
		assertThat(message.isDeleted()).isTrue();
	}

}
