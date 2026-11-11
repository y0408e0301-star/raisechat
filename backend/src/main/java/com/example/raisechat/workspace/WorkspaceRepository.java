package com.example.raisechat.workspace;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface WorkspaceRepository extends JpaRepository<Workspace, Long> {

	// 作れる数（BR-5）。users の自分の行をロックしてから数える
	long countByOwnerId(long ownerId);

	// 自分が入っているワークスペースを名前の順（同じ名前は作った順）に（W-1、FN-03 5 章の 7）
	@Query("""
			select new com.example.raisechat.workspace.WorkspaceMembership(w, m.role)
			from Workspace w join WorkspaceMember m on m.workspaceId = w.id
			where m.userId = :userId
			order by w.name, w.id
			""")
	List<WorkspaceMembership> findAllByMember(@Param("userId") long userId);

}
