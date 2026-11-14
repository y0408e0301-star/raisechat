package com.example.raisechat.message;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import com.example.raisechat.TestEntities;
import com.example.raisechat.attachment.Attachments;
import com.example.raisechat.conversation.Conversation;
import com.example.raisechat.conversation.ConversationAccess;
import com.example.raisechat.conversation.ConversationRepository;
import com.example.raisechat.conversation.DirectMessages;
import com.example.raisechat.realtime.RealtimeNotifier;
import com.example.raisechat.user.UserRepository;
import com.example.raisechat.workspace.WorkspaceAccess;
import com.example.raisechat.workspace.WorkspaceMember;

// 送信で、同じ clientId が同時に送られて一意の制約に反したとき（FN-07 5 章の 8）を、データベースを使わずに確かめる
@ExtendWith(MockitoExtension.class)
class MessageServiceTests {

	private static final long TARO = 1;

	private static final long CONVERSATION = 10;

	private static final UUID CLIENT_ID = UUID.fromString("6f1c2a0e-8b1d-4c55-9a7e-0d2f5b3c9e11");

	@Mock
	MessageRepository messages;

	@Mock
	ConversationRepository conversations;

	@Mock
	ConversationAccess access;

	@Mock
	Attachments attachments;

	@Mock
	WorkspaceAccess workspaceAccess;

	@Mock
	UserRepository users;

	@Mock
	RealtimeNotifier notifier;

	@Mock
	DirectMessages directMessages;

	private MessageService service;

	@BeforeEach
	void setUp() {
		this.service = new MessageService(this.messages, this.conversations, this.access, this.attachments,
				this.workspaceAccess, this.users, TestEntities.userSummaries(), TestEntities.fixedClock(),
				TestEntities.immediateTransaction(), this.notifier, this.directMessages);
		when(this.access.requireVisible(TARO, CONVERSATION))
			.thenReturn(TestEntities.withId(Conversation.general(3, TARO, TestEntities.NOW), CONVERSATION));
	}

	private static DataIntegrityViolationException violation(String constraint) {
		return new DataIntegrityViolationException("違反",
				new ConstraintViolationException("違反", new SQLException("違反"), constraint));
	}

	@Test
	void 一意の制約に反したら_先に追加されたものを読み直して返す() {
		Message first = TestEntities.withId(new Message(CONVERSATION, TARO, CLIENT_ID, "本文", TestEntities.NOW), 30);
		when(this.messages.findByUserIdAndClientId(TARO, CLIENT_ID)).thenReturn(Optional.empty())
			.thenReturn(Optional.of(first));
		when(this.messages.saveAndFlush(any())).thenThrow(violation("messages_user_client_key"));
		when(this.workspaceAccess.requireMember(TARO, 3))
			.thenReturn(new WorkspaceMember(3, TARO, WorkspaceMember.Role.MEMBER, TestEntities.NOW));
		when(this.users.findAllById(Set.of(TARO))).thenReturn(List.of(TestEntities.user(TARO, "taro_y")));

		MessageView view = this.service.post(TARO, CONVERSATION, "本文", CLIENT_ID.toString(), null);

		assertThat(view.id()).isEqualTo(30);
		// 先に追加した方が通知を送っているので、2 つ目は送らない
		verifyNoInteractions(this.notifier);
	}

	@Test
	void ほかの制約に反したときはそのまま投げる() {
		when(this.messages.findByUserIdAndClientId(TARO, CLIENT_ID)).thenReturn(Optional.empty());
		DataIntegrityViolationException other = violation("messages_conversation_id_fkey");
		when(this.messages.saveAndFlush(any())).thenThrow(other);

		assertThatThrownBy(() -> this.service.post(TARO, CONVERSATION, "本文", CLIENT_ID.toString(), null))
			.isSameAs(other);
	}

}
