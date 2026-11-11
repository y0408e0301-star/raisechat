package com.example.raisechat.workspace;

import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMember, WorkspaceMember.Key> {

	long countByWorkspaceId(long workspaceId);

}
