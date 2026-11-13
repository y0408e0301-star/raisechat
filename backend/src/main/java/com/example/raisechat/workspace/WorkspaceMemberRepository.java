package com.example.raisechat.workspace;

import java.time.Instant;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMember, WorkspaceMember.Key> {

	long countByWorkspaceId(long workspaceId);

	@Query("select m.userId from WorkspaceMember m where m.workspaceId = :workspaceId")
	List<Long> findUserIds(@Param("workspaceId") long workspaceId);

	// メンバー（MEMBER）として足す。もう入っていれば何もしない（参加の API が同時に 2 回来ても失敗しない。FN-04 5 章の 5）。
	// 足したら 1 を返す
	@Modifying
	@Query(value = """
			INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
			VALUES (:workspaceId, :userId, 'MEMBER', :joinedAt)
			ON CONFLICT DO NOTHING
			""", nativeQuery = true)
	int insertIfAbsent(@Param("workspaceId") long workspaceId, @Param("userId") long userId,
			@Param("joinedAt") Instant joinedAt);

}
