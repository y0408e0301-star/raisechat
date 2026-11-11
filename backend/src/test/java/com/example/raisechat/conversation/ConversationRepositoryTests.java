package com.example.raisechat.conversation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.jpa.test.autoconfigure.TestEntityManager;

import com.example.raisechat.RepositoryTest;
import com.example.raisechat.user.User;
import com.example.raisechat.workspace.Workspace;
import com.example.raisechat.workspace.WorkspaceMember;

import jakarta.persistence.PersistenceException;

// 見られる会話（データ設計書 8.1、BR-2）とサイドバーのチャンネル、会話の表の制約（データ設計書 4.5）。
// チャンネルの作成・DM の API はまだないので、general 以外の会話は SQL で入れる
@RepositoryTest
class ConversationRepositoryTests {

	private static final Instant NOW = Instant.parse("2026-11-11T03:00:00Z");

	@Autowired
	ConversationRepository conversations;

	@Autowired
	TestEntityManager em;

	private long taro;

	private long hanako;

	// ワークスペースに入っていない人
	private long jiro;

	private long workspaceId;

	private long general;

	@BeforeEach
	void setUp() {
		this.taro = this.em.persist(new User("taro_y", "たろう", "hash", NOW)).getId();
		this.hanako = this.em.persist(new User("hanako", "はなこ", "hash", NOW)).getId();
		this.jiro = this.em.persist(new User("jiro", "じろう", "hash", NOW)).getId();
		this.workspaceId = this.em.persist(new Workspace("仲間うち", this.taro, NOW)).getId();
		this.em.persist(new WorkspaceMember(this.workspaceId, this.taro, WorkspaceMember.Role.OWNER, NOW));
		this.em.persist(new WorkspaceMember(this.workspaceId, this.hanako, WorkspaceMember.Role.MEMBER, NOW));
		this.general = this.em.persist(Conversation.general(this.workspaceId, this.taro, NOW)).getId();
		this.em.persist(new ConversationMember(this.general, this.taro, 0, NOW));
		this.em.flush();
	}

	private long channel(String name, String visibility, long... members) {
		long id = ((Number) this.em.getEntityManager()
			.createNativeQuery("INSERT INTO conversations (workspace_id, type, name, visibility, created_by) "
					+ "VALUES (?, 'CHANNEL', ?, ?, ?) RETURNING id")
			.setParameter(1, this.workspaceId)
			.setParameter(2, name)
			.setParameter(3, visibility)
			.setParameter(4, this.taro)
			.getSingleResult()).longValue();
		for (long member : members) {
			this.em.persist(new ConversationMember(id, member, 0, NOW));
		}
		this.em.flush();
		return id;
	}

	private long dm(long low, long high) {
		return ((Number) this.em.getEntityManager()
			.createNativeQuery("INSERT INTO conversations (workspace_id, type, dm_user_low, dm_user_high, created_by) "
					+ "VALUES (?, 'DM', ?, ?, ?) RETURNING id")
			.setParameter(1, this.workspaceId)
			.setParameter(2, low)
			.setParameter(3, high)
			.setParameter(4, low)
			.getSingleResult()).longValue();
	}

	@Test
	void 公開チャンネルはワークスペースのメンバーなら入っていなくても見られる() {
		long travel = channel("旅行", "PUBLIC", this.taro);
		assertThat(this.conversations.findVisible(this.hanako, travel)).isPresent();
		assertThat(this.conversations.findVisible(this.hanako, this.general)).isPresent();
	}

	@Test
	void ワークスペースに入っていない人は何も見られない() {
		long travel = channel("旅行", "PUBLIC", this.taro);
		assertThat(this.conversations.findVisible(this.jiro, travel)).isEmpty();
		assertThat(this.conversations.findVisible(this.jiro, this.general)).isEmpty();
	}

	@Test
	void プライベートチャンネルは入っている人だけが見られる() {
		long secret = channel("運営", "PRIVATE", this.taro);
		assertThat(this.conversations.findVisible(this.taro, secret)).isPresent();
		assertThat(this.conversations.findVisible(this.hanako, secret)).isEmpty();
	}

	@Test
	void DMは2人のうちの1人で_いまワークスペースのメンバーなら見られる() {
		long dm = dm(this.taro, this.hanako);
		long withJiro = dm(this.taro, this.jiro);
		assertThat(this.conversations.findVisible(this.taro, dm)).isPresent();
		assertThat(this.conversations.findVisible(this.hanako, dm)).isPresent();
		// jiro は DM の 1 人だが、ワークスペースのメンバーではない
		assertThat(this.conversations.findVisible(this.jiro, withJiro)).isEmpty();
		assertThat(this.conversations.findVisible(this.hanako, withJiro)).isEmpty();
	}

	@Test
	void ない会話は見られない() {
		assertThat(this.conversations.findVisible(this.taro, 999_999)).isEmpty();
	}

	// 画面設計書 2.8
	@Test
	void サイドバーには入っているチャンネルだけを_generalを先頭に名前の順で出す() {
		long b = channel("Beta", "PUBLIC", this.taro);
		long a = channel("alpha", "PRIVATE", this.taro);
		channel("入っていない", "PUBLIC", this.hanako);
		dm(this.taro, this.hanako);
		assertThat(this.conversations.findJoinedChannels(this.taro, this.workspaceId)).extracting(Conversation::getId)
			.containsExactly(this.general, a, b);
	}

	@Test
	void generalはワークスペースごとに1つ() {
		assertThat(this.conversations.findGeneral(this.workspaceId)).get()
			.extracting(Conversation::getId)
			.isEqualTo(this.general);
		assertThatExceptionOfType(PersistenceException.class)
			.isThrownBy(() -> this.em.persistAndFlush(Conversation.general(this.workspaceId, this.hanako, NOW)));
	}

	@Test
	void 同じ名前のチャンネルは大文字小文字を区別せずに作れない() {
		channel("Travel", "PUBLIC");
		assertThatExceptionOfType(PersistenceException.class).isThrownBy(() -> channel("travel", "PUBLIC"));
	}

	@Test
	void DMの2人は小さいIDが先() {
		assertThatExceptionOfType(PersistenceException.class).isThrownBy(() -> dm(this.hanako, this.taro));
	}

}
