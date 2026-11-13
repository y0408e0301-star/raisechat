package com.example.raisechat.workspace;

import java.util.List;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

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

	// 削除するとき（W-6）。同時に招待リンクで参加した人に通知を送り漏らさないよう、行をロックしてからメンバーを読む
	// （参加の INSERT は外部キーの確かめでこの行を共有ロックするので、削除の後になる）
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select w from Workspace w where w.id = :id")
	Optional<Workspace> findByIdForUpdate(@Param("id") long id);

}
