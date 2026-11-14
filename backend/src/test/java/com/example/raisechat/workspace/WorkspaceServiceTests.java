package com.example.raisechat.workspace;

import static com.example.raisechat.ApiAssertions.assertApiError;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.example.raisechat.TestEntities;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.conversation.Conversation;
import com.example.raisechat.conversation.ConversationMember;
import com.example.raisechat.conversation.ConversationMemberRepository;
import com.example.raisechat.conversation.ConversationRepository;
import com.example.raisechat.realtime.RealtimeNotifier;
import com.example.raisechat.realtime.SubscriptionRevoker;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.user.UserSummary;

// ワークスペースの作成・詳細（FN-03）の処理を、データベースを使わずに確かめる
@ExtendWith(MockitoExtension.class)
class WorkspaceServiceTests {

	private static final long TARO = 1;

	@Mock
	WorkspaceRepository workspaces;

	@Mock
	WorkspaceMemberRepository members;

	@Mock
	ConversationRepository conversations;

	@Mock
	ConversationMemberRepository conversationMembers;

	@Mock
	UserRepository users;

	@Mock
	RealtimeNotifier notifier;

	@Mock
	SubscriptionRevoker revoker;

	private WorkspaceService service;

	@BeforeEach
	void setUp() {
		this.service = new WorkspaceService(this.workspaces, this.members, new WorkspaceAccess(this.members),
				this.conversations, this.conversationMembers, this.users, TestEntities.userSummaries(), this.notifier,
				this.revoker, TestEntities.fixedClock());
	}

	@Test
	void 作るとオーナーとgeneralと自分のメンバーの行を作る() {
		when(this.users.findByIdForUpdate(TARO)).thenReturn(Optional.of(TestEntities.user(TARO, "taro_y")));
		when(this.workspaces.countByOwnerId(TARO)).thenReturn(9L);
		when(this.workspaces.save(any())).thenAnswer((i) -> TestEntities.withId(i.getArgument(0), 10));
		when(this.conversations.save(any())).thenAnswer((i) -> TestEntities.withId(i.getArgument(0), 20));

		WorkspaceDetail detail = this.service.create(TARO, " 仲間うち ");

		assertThat(detail).isEqualTo(new WorkspaceDetail(10, "仲間うち", WorkspaceMember.Role.OWNER, false, 0,
				new UserSummary("taro_y", "taro_yの表示名", null, null, null), 1, 20, null));
		// 数える前に自分の行をロックする（BR-5）
		InOrder order = inOrder(this.users, this.workspaces);
		order.verify(this.users).findByIdForUpdate(TARO);
		order.verify(this.workspaces).countByOwnerId(TARO);

		ArgumentCaptor<WorkspaceMember> member = ArgumentCaptor.forClass(WorkspaceMember.class);
		verify(this.members).save(member.capture());
		assertThat(member.getValue().getRole()).isEqualTo(WorkspaceMember.Role.OWNER);
		assertThat(member.getValue().getWorkspaceId()).isEqualTo(10);
		ArgumentCaptor<Conversation> general = ArgumentCaptor.forClass(Conversation.class);
		verify(this.conversations).save(general.capture());
		assertThat(general.getValue().isGeneral()).isTrue();
		assertThat(general.getValue().getName()).isEqualTo("general");
		assertThat(general.getValue().getVisibility()).isEqualTo(Conversation.Visibility.PUBLIC);
		ArgumentCaptor<ConversationMember> joined = ArgumentCaptor.forClass(ConversationMember.class);
		verify(this.conversationMembers).save(joined.capture());
		assertThat(joined.getValue().getConversationId()).isEqualTo(20);
		assertThat(joined.getValue().getUserId()).isEqualTo(TARO);
	}

	// TC-03-3
	@Test
	void すでに10個作っていれば作らない() {
		when(this.users.findByIdForUpdate(TARO)).thenReturn(Optional.of(TestEntities.user(TARO, "taro_y")));
		when(this.workspaces.countByOwnerId(TARO)).thenReturn(10L);

		assertApiError(() -> this.service.create(TARO, "11 個目"), ErrorCode.WORKSPACE_LIMIT);
		verify(this.workspaces, never()).save(any());
	}

	@Test
	void 名前が条件に合わなければロックもしない() {
		assertApiError(() -> this.service.create(TARO, " "), ErrorCode.WORKSPACE_NAME_REQUIRED, "name");
		verify(this.users, never()).findByIdForUpdate(TARO);
	}

	@Test
	void 入っていないワークスペースの詳細は404() {
		when(this.members.findById(new WorkspaceMember.Key(10, TARO))).thenReturn(Optional.empty());
		assertApiError(() -> this.service.get(TARO, 10), ErrorCode.WORKSPACE_NOT_FOUND);
	}

	// TC-03-5
	@Test
	void 最後に開いた会話が見られなくなっていればなしとして返す() {
		WorkspaceMember member = new WorkspaceMember(10, TARO, WorkspaceMember.Role.MEMBER, TestEntities.NOW);
		member.openConversation(30);
		when(this.members.findById(new WorkspaceMember.Key(10, TARO))).thenReturn(Optional.of(member));
		when(this.workspaces.findById(10L))
			.thenReturn(Optional.of(TestEntities.withId(new Workspace("仲間うち", 2, TestEntities.NOW), 10)));
		when(this.users.findById(2L)).thenReturn(Optional.of(TestEntities.user(2, "hanako")));
		when(this.conversations.findGeneral(10))
			.thenReturn(Optional.of(TestEntities.withId(Conversation.general(10, 2, TestEntities.NOW), 20)));
		when(this.conversations.findVisible(TARO, 30)).thenReturn(Optional.empty());
		when(this.members.countByWorkspaceId(10)).thenReturn(2L);

		WorkspaceDetail detail = this.service.get(TARO, 10);

		assertThat(detail.lastOpenedConversationId()).isNull();
		assertThat(detail.generalConversationId()).isEqualTo(20);
		assertThat(detail.role()).isEqualTo(WorkspaceMember.Role.MEMBER);
		assertThat(detail.owner().username()).isEqualTo("hanako");
		assertThat(detail.memberCount()).isEqualTo(2);
	}

}
