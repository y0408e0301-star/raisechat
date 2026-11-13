package com.example.raisechat.workspace;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.regex.Pattern;

import org.jspecify.annotations.Nullable;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.conversation.WorkspaceEntry;
import com.example.raisechat.realtime.RealtimeProperties;
import com.example.raisechat.user.UserRepository;

// 招待リンクの作成・一覧・取り消しと、招待リンクからの参加（機能定義書 FN-04）
@Service
class InviteService {

	// G-11 の一覧を 1 回に読む件数（FN-04 6 章）
	static final int PAGE_SIZE = 50;

	// 32 バイトの乱数の Base64URL（パディングなし）の形（FN-04 4 章）
	private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{43}");

	private final InviteRepository invites;

	private final WorkspaceRepository workspaces;

	private final WorkspaceMemberRepository members;

	private final WorkspaceAccess access;

	private final WorkspaceService workspaceService;

	private final WorkspaceEntry entry;

	private final UserRepository users;

	private final RealtimeProperties web;

	private final Clock clock;

	private final SecureRandom random = new SecureRandom();

	InviteService(InviteRepository invites, WorkspaceRepository workspaces, WorkspaceMemberRepository members,
			WorkspaceAccess access, WorkspaceService workspaceService, WorkspaceEntry entry, UserRepository users,
			RealtimeProperties web, Clock clock) {
		this.invites = invites;
		this.workspaces = workspaces;
		this.members = members;
		this.access = access;
		this.workspaceService = workspaceService;
		this.entry = entry;
		this.users = users;
		this.web = web;
		this.clock = clock;
	}

	// G-11 の一覧（I-1）：まだ消していないリンクを作った新しい順に 50 件ずつ。cursor は前のページの最後の ID
	@Transactional(readOnly = true)
	InvitePage list(long me, long workspaceId, @Nullable String cursor) {
		requireOwner(me, workspaceId);
		long beforeId = parseCursor(cursor);
		List<Invite> found = this.invites.findByWorkspaceIdAndIdLessThanOrderByIdDesc(workspaceId, beforeId,
				Limit.of(PAGE_SIZE + 1));
		List<Invite> page = found.subList(0, Math.min(PAGE_SIZE, found.size()));
		Instant now = this.clock.instant();
		String next = (found.size() > PAGE_SIZE) ? String.valueOf(page.getLast().getId()) : null;
		return new InvitePage(page.stream().map((i) -> view(i, now)).toList(), next);
	}

	// 作る（I-2）。期限は 7 日後
	@Transactional
	InviteView create(long me, long workspaceId) {
		requireOwner(me, workspaceId);
		Instant now = this.clock.instant();
		Invite invite = this.invites.save(new Invite(workspaceId, newToken(), me, now));
		return view(invite, now);
	}

	// 取り消す（I-3）。行は消さずに取り消した日時を記録する。取り消し済み・期限切れでも 204
	@Transactional
	void revoke(long me, long workspaceId, long inviteId) {
		requireOwner(me, workspaceId);
		Invite invite = this.invites.findForUpdate(workspaceId, inviteId)
			.orElseThrow(() -> new ApiException(ErrorCode.INVITE_NOT_FOUND));
		invite.revoke(this.clock.instant());
	}

	// G-4 に出す中身（I-4〜I-7）。ログインしていない人（me が null）にはワークスペースの名前だけを返す（5 章の 3）
	@Transactional(readOnly = true)
	InvitePreview preview(@Nullable Long me, String token) {
		Invite invite = requireUsable(this.invites.findByToken(valid(token)).orElse(null));
		Workspace workspace = this.workspaces.findById(invite.getWorkspaceId()).orElseThrow();
		if (me == null) {
			return new InvitePreview(workspace.getName(), null, null, null, null);
		}
		String ownerName = this.users.findById(workspace.getOwnerId()).orElseThrow().getDisplayName();
		boolean member = this.members.existsById(new WorkspaceMember.Key(workspace.getId(), me));
		return new InvitePreview(workspace.getName(), workspace.getId(), ownerName,
				this.members.countByWorkspaceId(workspace.getId()), member);
	}

	// 参加する（I-5・I-8）。G-4 を開いた後に期限が切れた・取り消されたときのため、もう一度確かめる（5 章の 1）。
	// すでにメンバーなら何もしない（5 章の 5）。ほかのメンバーには通知しない（5 章の 6）
	@Transactional
	WorkspaceDetail accept(long me, String token) {
		Invite invite = requireUsable(this.invites.findByTokenForShare(valid(token)).orElse(null));
		long workspaceId = invite.getWorkspaceId();
		if (this.members.insertIfAbsent(workspaceId, me, this.clock.instant()) == 1) {
			this.entry.enter(me, workspaceId);
		}
		return this.workspaceService.get(me, workspaceId);
	}

	// 招待リンクの管理はオーナーだけ（FN-04 8 章）。メンバーでなければ 404、オーナーでなければ 403
	private void requireOwner(long me, long workspaceId) {
		if (this.access.requireMember(me, workspaceId).getRole() != WorkspaceMember.Role.OWNER) {
			throw new ApiException(ErrorCode.NOT_OWNER);
		}
	}

	private Invite requireUsable(@Nullable Invite invite) {
		if (invite == null || invite.status(this.clock.instant()) != Invite.Status.ACTIVE) {
			throw new ApiException(ErrorCode.INVITE_INVALID);
		}
		return invite;
	}

	// 形が違う文字列も、見つからないときと同じく 410（FN-04 4 章）
	private static String valid(String token) {
		if (!TOKEN.matcher(token).matches()) {
			throw new ApiException(ErrorCode.INVITE_INVALID);
		}
		return token;
	}

	private static long parseCursor(@Nullable String cursor) {
		if (cursor == null || cursor.isEmpty()) {
			return Long.MAX_VALUE;
		}
		try {
			long id = Long.parseLong(cursor);
			if (id > 0) {
				return id;
			}
		}
		catch (NumberFormatException ex) {
			// 下で 400 にする
		}
		throw new ApiException(ErrorCode.BAD_REQUEST, "cursor");
	}

	// 推測できない 32 バイトの乱数を、URL に入れられる文字（Base64URL）にしたもの（要件定義書 N-22）
	private String newToken() {
		byte[] bytes = new byte[32];
		this.random.nextBytes(bytes);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	private InviteView view(Invite invite, Instant now) {
		return new InviteView(invite.getId(), this.web.origin() + "/invite/" + invite.getToken(), invite.getCreatedAt(),
				invite.getExpiresAt(), invite.getRevokedAt(), invite.status(now));
	}

	// G-11 の一覧（機能定義書 3.4 の形）
	record InvitePage(List<InviteView> items, @Nullable String nextCursor) {
	}

	// G-11 の 1 行（FN-04 6 章の InviteView）
	record InviteView(long id, String url, Instant createdAt, Instant expiresAt, @Nullable Instant revokedAt,
			Invite.Status status) {
	}

	// G-4 に出す中身（FN-04 6 章の InvitePreview）。名前のほかは、ログインしているときだけ入れる
	record InvitePreview(String workspaceName, @Nullable Long workspaceId, @Nullable String ownerDisplayName,
			@Nullable Long memberCount, @Nullable Boolean alreadyMember) {
	}

}
