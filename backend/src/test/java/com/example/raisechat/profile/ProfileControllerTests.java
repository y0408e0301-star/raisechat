package com.example.raisechat.profile;

import static com.example.raisechat.ControllerTestSupport.assertError;
import static com.example.raisechat.ControllerTestSupport.loggedIn;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

import com.example.raisechat.ControllerTest;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.user.UserSummary;

// プロフィールの API（FN-02 6 章）の入口：アバターの multipart・ログインと CSRF・思いがけない失敗。
// 処理の中身は ProfileServiceTests・ProfileApiTests
@ControllerTest(ProfileController.class)
class ProfileControllerTests {

	private static final UserSummary TARO = new UserSummary("taro_y", "たろう", null, null, null);

	@Autowired
	MockMvcTester mvc;

	@MockitoBean
	ProfileService profileService;

	@Test
	void アバターはmultipartのfileで受け取る() {
		when(this.profileService.changeAvatar(eq(7L), any())).thenReturn(TARO);
		assertThat(upload(true)).hasStatusOk().bodyJson().extractingPath("$.username").isEqualTo("taro_y");
	}

	@Test
	void CSRFトークンがなければ受け取らない() {
		assertError(upload(false), ErrorCode.FORBIDDEN);
		verifyNoInteractions(this.profileService);
	}

	// 画像の読み込みの順番待ちが長すぎたとき（Images.read の IllegalStateException）など。中身は見せず M-49
	@Test
	void 思いがけない失敗は500でM49を返す() {
		when(this.profileService.changeAvatar(eq(7L), any()))
			.thenThrow(new IllegalStateException("画像の読み込みが混んでいて、待ちきれませんでした"));
		assertError(upload(true), ErrorCode.INTERNAL_ERROR);
	}

	private MvcTestResult upload(boolean withCsrf) {
		var request = multipart(HttpMethod.PUT, "/api/me/avatar")
			.file(new MockMultipartFile("file", "a.png", "image/png", new byte[] { 1 }))
			.with(loggedIn(7));
		return this.mvc.perform(withCsrf ? request.with(csrf()) : request);
	}

}
