package com.example.raisechat.workspace;

import java.time.Instant;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.example.raisechat.user.User;

public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMember, WorkspaceMember.Key> {

	long countByWorkspaceId(long workspaceId);

	@Query("select m.userId from WorkspaceMember m where m.workspaceId = :workspaceId")
	List<Long> findUserIds(@Param("workspaceId") long workspaceId);

	// メンバーの一覧（MB-1）：オーナーを先頭に、表示名の順（同じ表示名はユーザー ID の順。FN-05 5 章の 6）。
	// :pattern は表示名かユーザー ID に含む文字（LIKE の形）。続きは (順位, 表示名, ユーザー ID) が :after… より後ろの人
	@Query(value = """
			SELECT u.* FROM users u JOIN workspace_members w ON w.user_id = u.id
			WHERE w.workspace_id = :workspaceId
			  AND (lower(u.display_name) LIKE lower(:pattern) ESCAPE '\\' OR lower(u.username) LIKE lower(:pattern) ESCAPE '\\')
			  AND (CASE WHEN w.role = 'OWNER' THEN 0 ELSE 1 END, lower(u.display_name), lower(u.username))
			      > (:afterRank, lower(:afterName), lower(:afterUsername))
			ORDER BY CASE WHEN w.role = 'OWNER' THEN 0 ELSE 1 END, lower(u.display_name), lower(u.username)
			LIMIT :limit
			""",
			nativeQuery = true)
	List<User> findMembers(@Param("workspaceId") long workspaceId, @Param("pattern") String pattern,
			@Param("afterRank") int afterRank, @Param("afterName") String afterName,
			@Param("afterUsername") String afterUsername, @Param("limit") int limit);

	@Query("select m from WorkspaceMember m where m.workspaceId = :workspaceId and m.userId in :userIds")
	List<WorkspaceMember> findByUserIds(@Param("workspaceId") long workspaceId, @Param("userIds") List<Long> userIds);

	// キック・退出（MB-4・MB-5）。消したら 1 を返す（同時のキックで、もういなければ 0）
	@Modifying
	@Query("delete from WorkspaceMember m where m.workspaceId = :workspaceId and m.userId = :userId")
	int deleteMember(@Param("workspaceId") long workspaceId, @Param("userId") long userId);

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
