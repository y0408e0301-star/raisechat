package com.example.raisechat.workspace;

// 自分が入っているワークスペースと、そこでの役割（WorkspaceRepository.findAllByMember）
record WorkspaceMembership(Workspace workspace, WorkspaceMember.Role role) {
}
