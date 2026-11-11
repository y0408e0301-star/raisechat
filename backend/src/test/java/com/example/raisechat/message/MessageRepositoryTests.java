package com.example.raisechat.message;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.jpa.test.autoconfigure.TestEntityManager;
import org.springframework.data.domain.Limit;

import com.example.raisechat.RepositoryTest;
import com.example.raisechat.conversation.Conversation;
import com.example.raisechat.user.User;
import com.example.raisechat.workspace.Workspace;

import jakarta.persistence.PersistenceException;

// メッセージの読み込み（FN-07 MS-1・MS-2、5 章の 3・8、データ設計書 4.7）
@RepositoryTest
class MessageRepositoryTests {

	private static final Instant NOW = Instant.parse("2026-11-11T03:00:00Z");

	@Autowired
	MessageRepository messages;

	@Autowired
	TestEntityManager em;

	private long taro;

	private long general;

	private long other;

	@BeforeEach
	void setUp() {
		this.taro = this.em.persist(new User("taro_y", "たろう", "hash", NOW)).getId();
		long ws = this.em.persist(new Workspace("仲間うち", this.taro, NOW)).getId();
		long ws2 = this.em.persist(new Workspace("ほか", this.taro, NOW)).getId();
		this.general = this.em.persist(Conversation.general(ws, this.taro, NOW)).getId();
		this.other = this.em.persist(Conversation.general(ws2, this.taro, NOW)).getId();
	}

	private long send(long conversationId, String body) {
		return this.em.persist(new Message(conversationId, this.taro, UUID.randomUUID(), body, NOW)).getId();
	}

	// スレッドの返信（1-12 で API を作る）
	private long reply(long parentId) {
		Message reply = new Message(this.general, this.taro, UUID.randomUUID(), "返信", NOW);
		org.springframework.test.util.ReflectionTestUtils.setField(reply, "parentId", parentId);
		return this.em.persist(reply).getId();
	}

	@Test
	void 最新と前と後ろを_親メッセージだけ_その会話のものだけ読む() {
		List<Long> ids = IntStream.rangeClosed(1, 5).mapToObj((i) -> send(this.general, "m" + i)).toList();
		reply(ids.get(2));
		send(this.other, "ほかの会話");
		this.em.flush();

		assertThat(this.messages.findLatest(this.general, Limit.of(3))).extracting(Message::getId)
			.containsExactly(ids.get(4), ids.get(3), ids.get(2));
		assertThat(this.messages.findBefore(this.general, ids.get(2), Limit.of(10))).extracting(Message::getId)
			.containsExactly(ids.get(1), ids.get(0));
		assertThat(this.messages.findAfter(this.general, ids.get(2), Limit.of(10))).extracting(Message::getId)
			.containsExactly(ids.get(3), ids.get(4));
		assertThat(this.messages.existsBefore(this.general, ids.get(0))).isFalse();
		assertThat(this.messages.existsAfter(this.general, ids.get(4))).isFalse();
		assertThat(this.messages.existsAfter(this.general, ids.get(3))).isTrue();
	}

	@Test
	void 既読の位置にできるのはその会話の親メッセージだけ() {
		long parent = send(this.general, "親");
		long child = reply(parent);
		long elsewhere = send(this.other, "ほか");
		this.em.flush();
		assertThat(this.messages.isParentInConversation(parent, this.general)).isTrue();
		assertThat(this.messages.isParentInConversation(child, this.general)).isFalse();
		assertThat(this.messages.isParentInConversation(elsewhere, this.general)).isFalse();
	}

	// TC-07-12
	@Test
	void 同じ人の同じclientIdは2つ入らない() {
		UUID clientId = UUID.randomUUID();
		this.em.persistAndFlush(new Message(this.general, this.taro, clientId, "1 回目", NOW));
		assertThat(this.messages.findByUserIdAndClientId(this.taro, clientId)).isPresent();
		assertThatExceptionOfType(PersistenceException.class)
			.isThrownBy(() -> this.em.persistAndFlush(new Message(this.general, this.taro, clientId, "2 回目", NOW)));
	}

	@Test
	void 会話を消すとメッセージも消える() {
		send(this.general, "消える");
		this.em.flush();
		this.em.getEntityManager()
			.createNativeQuery("DELETE FROM conversations WHERE id = ?")
			.setParameter(1, this.general)
			.executeUpdate();
		this.em.clear();
		assertThat(this.messages.findLatest(this.general, Limit.of(10))).isEmpty();
	}

}
