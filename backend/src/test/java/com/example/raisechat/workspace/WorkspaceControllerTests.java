package com.example.raisechat.workspace;

import static com.example.raisechat.ControllerTestSupport.assertError;
import static com.example.raisechat.ControllerTestSupport.loggedIn;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

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

// ワークスペースの API（FN-03 6 章）の入口：URL・ステータス・JSON の形・ログインと CSRF。処理の中身は WorkspaceServiceTests
@ControllerTest(WorkspaceController.class)
class WorkspaceControllerTests {

	private static final WorkspaceDetail DETAIL = new WorkspaceDetail(3, "仲間うち", WorkspaceMember.Role.OWNER, false, 0,
			new UserSummary("taro_y", "たろう", null, null, null), 1, 12, null);

	@Autowired
	MockMvcTester mvc;

	@MockitoBean
	WorkspaceService workspaceService;

	@Test
	void 一覧を返す() {
		when(this.workspaceService.list(7))
			.thenReturn(List.of(new WorkspaceSummary(3, "仲間うち", WorkspaceMember.Role.OWNER, false, 0)));
		assertThat(this.mvc.get().uri("/api/workspaces").with(loggedIn(7))).hasStatusOk()
			.bodyJson()
			.isStrictlyEqualTo("""
					[{"id":3,"name":"仲間うち","role":"OWNER","hasUnread":false,"mentionCount":0}]
					""");
	}

	@Test
	void 作ると201で詳細を返す() {
		when(this.workspaceService.create(7, "仲間うち")).thenReturn(DETAIL);
		assertThat(this.mvc.post()
			.uri("/api/workspaces")
			.with(loggedIn(7))
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"name\":\"仲間うち\"}")).hasStatus(HttpStatus.CREATED)
			.bodyJson()
			.isStrictlyEqualTo(
					"""
							{"id":3,"name":"仲間うち","role":"OWNER","hasUnread":false,"mentionCount":0,
							 "owner":{"username":"taro_y","displayName":"たろう","avatarUrl":null,"statusEmoji":null,"statusText":null},
							 "memberCount":1,"generalConversationId":12,"lastOpenedConversationId":null}
							""");
	}

	@Test
	void 上限のときは409と画面に出すメッセージ() {
		when(this.workspaceService.create(7, "11 個目")).thenThrow(new ApiException(ErrorCode.WORKSPACE_LIMIT));
		assertError(this.mvc.post()
			.uri("/api/workspaces")
			.with(loggedIn(7))
			.with(csrf())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"name\":\"11 個目\"}")
			.exchange(), ErrorCode.WORKSPACE_LIMIT);
	}

	@Test
	void CSRFトークンがなければ作らない() {
		assertThat(this.mvc.post()
			.uri("/api/workspaces")
			.with(loggedIn(7))
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"name\":\"仲間うち\"}")).hasStatus(HttpStatus.FORBIDDEN);
		verifyNoInteractions(this.workspaceService);
	}

	@Test
	void 詳細_入っていなければ404() {
		when(this.workspaceService.get(7, 3)).thenReturn(DETAIL);
		when(this.workspaceService.get(7, 4)).thenThrow(new ApiException(ErrorCode.WORKSPACE_NOT_FOUND));
		assertThat(this.mvc.get().uri("/api/workspaces/3").with(loggedIn(7))).hasStatusOk()
			.bodyJson()
			.extractingPath("$.generalConversationId")
			.isEqualTo(12);
		assertError(this.mvc.get().uri("/api/workspaces/4").with(loggedIn(7)).exchange(),
				ErrorCode.WORKSPACE_NOT_FOUND);
	}

	@Test
	void ログインしていなければ401() {
		assertThat(this.mvc.get().uri("/api/workspaces")).hasStatus(HttpStatus.UNAUTHORIZED);
		verifyNoInteractions(this.workspaceService);
	}

}
