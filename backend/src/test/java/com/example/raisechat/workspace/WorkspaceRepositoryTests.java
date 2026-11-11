package com.example.raisechat.workspace;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;
import static org.assertj.core.groups.Tuple.tuple;

import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.jpa.test.autoconfigure.TestEntityManager;

import com.example.raisechat.RepositoryTest;
import com.example.raisechat.user.User;

import jakarta.persistence.PersistenceException;

// ワークスペースの一覧と作れる数（FN-03 W-1・BR-5、データ設計書 4.2・4.3）
@RepositoryTest
class WorkspaceRepositoryTests {

	private static final Instant NOW = Instant.parse("2026-11-11T03:00:00Z");

	@Autowired
	WorkspaceRepository workspaces;

	@Autowired
	TestEntityManager em;

	private long taro;

	private long hanako;

	@BeforeEach
	void setUp() {
		this.taro = this.em.persist(new User("taro_y", "たろう", "hash", NOW)).getId();
		this.hanako = this.em.persist(new User("hanako", "はなこ", "hash", NOW)).getId();
	}

	private Workspace workspace(String name, long owner, long... members) {
		Workspace workspace = this.em.persist(new Workspace(name, owner, NOW));
		this.em.persist(new WorkspaceMember(workspace.getId(), owner, WorkspaceMember.Role.OWNER, NOW));
		for (long member : members) {
			this.em.persist(new WorkspaceMember(workspace.getId(), member, WorkspaceMember.Role.MEMBER, NOW));
		}
		return workspace;
	}

	// TC-03-4・FN-03 5 章の 7
	@Test
	void 自分が入っているものだけを名前の順に_同じ名前は作った順に返す() {
		Workspace second = workspace("旅行サークル", this.taro);
		Workspace first = workspace("仲間うち", this.hanako, this.taro);
		Workspace same = workspace("旅行サークル", this.taro);
		workspace("はなこだけ", this.hanako);
		this.em.flush();

		assertThat(this.workspaces.findAllByMember(this.taro))
			.extracting((m) -> m.workspace().getId(), WorkspaceMembership::role)
			.containsExactly(tuple(first.getId(), WorkspaceMember.Role.MEMBER),
					tuple(second.getId(), WorkspaceMember.Role.OWNER), tuple(same.getId(), WorkspaceMember.Role.OWNER));
	}

	@Test
	void 作れる数はオーナーのものだけを数える() {
		workspace("1", this.taro);
		workspace("2", this.taro, this.hanako);
		workspace("3", this.hanako, this.taro);
		this.em.flush();
		assertThat(this.workspaces.countByOwnerId(this.taro)).isEqualTo(2);
	}

	@Test
	void オーナーはワークスペースごとに1人() {
		Workspace workspace = workspace("仲間うち", this.taro);
		this.em.flush();
		assertThatExceptionOfType(PersistenceException.class).isThrownBy(() -> this.em
			.persistAndFlush(new WorkspaceMember(workspace.getId(), this.hanako, WorkspaceMember.Role.OWNER, NOW)));
	}

}
