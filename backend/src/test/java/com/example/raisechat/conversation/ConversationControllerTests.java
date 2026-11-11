package com.example.raisechat.conversation;

import static com.example.raisechat.ControllerTestSupport.assertError;
import static com.example.raisechat.ControllerTestSupport.loggedIn;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

import com.example.raisechat.ControllerTest;
import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.user.UserSummary;

// 会話の API（FN-06・FN-14 6 章）の入口：URL・ステータス・JSON の形。処理の中身は ConversationApiTests
@ControllerTest(ConversationController.class)
class ConversationControllerTests {

	private static final UserSummary TARO = new UserSummary("taro_y", "たろう", null, null, null);

	@Autowired
	MockMvcTester mvc;

	@MockitoBean
	ConversationService conversationService;

	@Test
	void サイドバーの一覧を機能定義書の形で返す() {
		when(this.conversationService.listForSidebar(7, 3))
			.thenReturn(List.of(new ConversationSummary(12, 3, Conversation.Type.CHANNEL, "general",
					Conversation.Visibility.PUBLIC, true, null, true, false, 0, 0, true)));
		assertThat(this.mvc.get().uri("/api/workspaces/3/conversations").with(loggedIn(7))).hasStatusOk()
			.bodyJson()
			.isStrictlyEqualTo("""
					[{"id":12,"workspaceId":3,"type":"CHANNEL","name":"general","visibility":"PUBLIC","general":true,
					  "dmPartner":null,"joined":true,"hasUnread":false,"unreadCount":0,"mentionCount":0,"canPost":true}]
					""");
	}

	@Test
	void 詳細は説明と人数と作った人も返す() {
		when(this.conversationService.get(7, 12)).thenReturn(
				new ConversationDetail(12, 3, Conversation.Type.CHANNEL, "general", Conversation.Visibility.PUBLIC,
						true, null, true, false, 0, 0, true, null, 2, TARO, Instant.parse("2026-11-11T03:00:00Z")));
		assertThat(this.mvc.get().uri("/api/conversations/12").with(loggedIn(7))).hasStatusOk()
			.bodyJson()
			.isLenientlyEqualTo("""
					{"id":12,"description":null,"memberCount":2,"createdBy":{"username":"taro_y"},
					 "createdAt":"2026-11-11T03:00:00Z"}
					""");
	}

	@Test
	void 見られない会話は404とM27() {
		when(this.conversationService.get(7, 99)).thenThrow(new ApiException(ErrorCode.CONVERSATION_NOT_FOUND));
		assertError(this.mvc.get().uri("/api/conversations/99").with(loggedIn(7)).exchange(),
				ErrorCode.CONVERSATION_NOT_FOUND);
	}

	@Test
	void 開いたことを記録すると204() {
		assertThat(this.mvc.post()
			.uri("/api/conversations/12/read")
			.with(loggedIn(7))
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"lastMessageId\":0}")).hasStatus(HttpStatus.NO_CONTENT);
		verify(this.conversationService).read(7, 12, 0L);
	}

	@Test
	void 最後のメッセージのIDがなければ400() {
		doThrow(new ApiException(ErrorCode.BAD_REQUEST, "lastMessageId")).when(this.conversationService)
			.read(7, 12, null);
		assertError(this.mvc.post()
			.uri("/api/conversations/12/read")
			.with(loggedIn(7))
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{}")
			.exchange(), ErrorCode.BAD_REQUEST, "lastMessageId");
	}

}
