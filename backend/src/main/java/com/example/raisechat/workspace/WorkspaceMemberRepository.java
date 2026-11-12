package com.example.raisechat.workspace;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMember, WorkspaceMember.Key> {

	long countByWorkspaceId(long workspaceId);

	@Query("select m.userId from WorkspaceMember m where m.workspaceId = :workspaceId")
	List<Long> findUserIds(@Param("workspaceId") long workspaceId);

}
