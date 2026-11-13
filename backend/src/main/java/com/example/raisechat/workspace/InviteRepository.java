package com.example.raisechat.workspace;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

interface InviteRepository extends JpaRepository<Invite, Long> {

	// G-11 の一覧（I-1）：作った新しい順。続きは :beforeId より前のもの
	List<Invite> findByWorkspaceIdAndIdLessThanOrderByIdDesc(long workspaceId, long beforeId, Limit limit);

	Optional<Invite> findByToken(String token);

	// 参加するとき。同時に取り消されても、取り消しの前か後かのどちらかになるよう、行を共有ロックする
	@Lock(LockModeType.PESSIMISTIC_READ)
	@Query("select i from Invite i where i.token = :token")
	Optional<Invite> findByTokenForShare(@Param("token") String token);

	// 取り消すとき。同時の参加が終わるのを待つ
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select i from Invite i where i.id = :id and i.workspaceId = :workspaceId")
	Optional<Invite> findForUpdate(@Param("workspaceId") long workspaceId, @Param("id") long id);

	// 作ってから 30 日たったもの（期限は 7 日なので、どれも期限切れか取り消し済み。BR-14）
	@Modifying
	@Query("delete from Invite i where i.createdAt <= :cutoff")
	int deleteCreatedBefore(@Param("cutoff") Instant cutoff);

}
