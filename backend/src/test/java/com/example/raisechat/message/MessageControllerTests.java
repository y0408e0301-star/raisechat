package com.example.raisechat.message;

import static com.example.raisechat.ControllerTestSupport.assertError;
import static com.example.raisechat.ControllerTestSupport.loggedIn;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

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

// メッセージの API（FN-07 6 章）の入口：URL・ステータス・JSON の形。処理の中身は MessageApiTests
@ControllerTest(MessageController.class)
class MessageControllerTests {

	private static final MessageView VIEW = new MessageView(30, 12, null,
			new UserSummary("taro_y", "たろう", null, null, null), "**土曜**", List.of(), 0, null,
			Instant.parse("2026-11-11T03:00:00Z"), null, false, true, true);

	private static final String VIEW_JSON = """
			{"id":30,"conversationId":12,"parentId":null,
			 "author":{"username":"taro_y","displayName":"たろう","avatarUrl":null,"statusEmoji":null,"statusText":null},
			 "body":"**土曜**","attachments":[],"replyCount":0,"lastReplyAt":null,"createdAt":"2026-11-11T03:00:00Z","editedAt":null,
			 "deleted":false,"mine":true,"canDelete":true}
			""";

	@Autowired
	MockMvcTester mvc;

	@MockitoBean
	MessageService messageService;

	@Test
	void 一覧は機能定義書の形で返す() {
		when(this.messageService.list(7, 12, 40L, null, 20))
			.thenReturn(new MessageService.MessagePage(List.of(VIEW), true, false));
		assertThat(this.mvc.get().uri("/api/conversations/12/messages?before=40&limit=20").with(loggedIn(7)))
			.hasStatusOk()
			.bodyJson()
			.isStrictlyEqualTo("{\"items\":[" + VIEW_JSON + "],\"hasMoreBefore\":true,\"hasMoreAfter\":false}");
	}

	@Test
	void 送ると201() {
		when(this.messageService.post(7, 12, "**土曜**", "6f1c2a0e-8b1d-4c55-9a7e-0d2f5b3c9e11", null)).thenReturn(VIEW);
		assertThat(this.mvc.post()
			.uri("/api/conversations/12/messages")
			.with(loggedIn(7))
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"body\":\"**土曜**\",\"clientId\":\"6f1c2a0e-8b1d-4c55-9a7e-0d2f5b3c9e11\"}"))
			.hasStatus(HttpStatus.CREATED)
			.bodyJson()
			.isStrictlyEqualTo(VIEW_JSON);
	}

	@Test
	void 長すぎる本文は400とM35() {
		when(this.messageService.post(7, 12, "x", "id", null))
			.thenThrow(new ApiException(ErrorCode.MESSAGE_TOO_LONG, "body"));
		assertError(this.mvc.post()
			.uri("/api/conversations/12/messages")
			.with(loggedIn(7))
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"body\":\"x\",\"clientId\":\"id\"}")
			.exchange(), ErrorCode.MESSAGE_TOO_LONG, "body");
	}

	@Test
	void 編集は200() {
		when(this.messageService.edit(7, 30, "直した", null)).thenReturn(VIEW);
		assertThat(this.mvc.patch()
			.uri("/api/messages/30")
			.with(loggedIn(7))
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"body\":\"直した\"}")).hasStatusOk();
	}

	@Test
	void 削除はデータごと消したら204_削除されましたにしたら200() {
		when(this.messageService.delete(7, 30)).thenReturn(Optional.empty());
		when(this.messageService.delete(7, 31)).thenReturn(Optional.of(VIEW));
		assertThat(this.mvc.delete().uri("/api/messages/30").with(loggedIn(7)).with(csrf()))
			.hasStatus(HttpStatus.NO_CONTENT);
		assertThat(this.mvc.delete().uri("/api/messages/31").with(loggedIn(7)).with(csrf())).hasStatusOk()
			.bodyJson()
			.extractingPath("$.id")
			.isEqualTo(30);
	}

	@Test
	void CSRFトークンがなければ送らない() {
		assertThat(this.mvc.post()
			.uri("/api/conversations/12/messages")
			.with(loggedIn(7))
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"body\":\"x\",\"clientId\":\"id\"}")).hasStatus(HttpStatus.FORBIDDEN);
		verifyNoInteractions(this.messageService);
	}

}
