package com.example.raisechat.profile;

import static com.example.raisechat.ApiAssertions.assertApiError;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessResourceFailureException;

import com.example.raisechat.TestEntities;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.emoji.Emojis;
import com.example.raisechat.storage.FileStorage;
import com.example.raisechat.storage.StorageDeleter;
import com.example.raisechat.storage.TestImages;
import com.example.raisechat.user.User;
import com.example.raisechat.user.UserRepository;

import software.amazon.awssdk.core.exception.SdkClientException;

// アバターを替える・外すときの S3 とデータベースの順番と、失敗したときの後始末（FN-02 3.1、データ設計書 BR-12）。
// うまくいくときの流れは ProfileApiTests で MinIO を通して確かめる
@ExtendWith(MockitoExtension.class)
class ProfileServiceTests {

	private static final long TARO = 1;

	@Mock
	UserRepository users;

	@Mock
	FileStorage storage;

	@Mock
	StorageDeleter deleter;

	private ProfileService service;

	private User taro;

	@BeforeEach
	void setUp() {
		this.service = new ProfileService(this.users, TestEntities.userSummaries(), mock(Emojis.class), this.storage,
				this.deleter, TestEntities.immediateTransaction(), TestEntities.fixedClock());
		this.taro = TestEntities.user(TARO, "taro_y");
	}

	@Test
	void 新しいアバターを置いてから記録し前のものを消す() {
		this.taro.changeAvatar("avatars/old.png", TestEntities.NOW);
		when(this.users.findByIdForUpdate(TARO)).thenReturn(Optional.of(this.taro));

		this.service.changeAvatar(TARO, TestImages.png(300, 200));

		ArgumentCaptor<String> key = ArgumentCaptor.forClass(String.class);
		verify(this.storage).put(key.capture(), eq("image/png"), any());
		assertThat(key.getValue()).matches("avatars/[0-9a-f-]{36}\\.png");
		assertThat(this.taro.getAvatarKey()).isEqualTo(key.getValue());
		verify(this.deleter).deleteOrRecord(List.of("avatars/old.png"));
	}

	@Test
	void 前のアバターがなければ何も消さない() {
		when(this.users.findByIdForUpdate(TARO)).thenReturn(Optional.of(this.taro));
		this.service.changeAvatar(TARO, TestImages.png(300, 200));
		verify(this.deleter, never()).deleteOrRecord(any());
	}

	// 置いたファイルはどこからも使われないので消す。前のアバターはそのまま
	@Test
	void データベースに記録できなければ置いたファイルを消す() {
		this.taro.changeAvatar("avatars/old.png", TestEntities.NOW);
		when(this.users.findByIdForUpdate(TARO)).thenThrow(new DataAccessResourceFailureException("DB が止まっている"));

		assertThatThrownBy(() -> this.service.changeAvatar(TARO, TestImages.png(300, 200)))
			.isInstanceOf(DataAccessResourceFailureException.class);

		ArgumentCaptor<String> key = ArgumentCaptor.forClass(String.class);
		verify(this.storage).put(key.capture(), anyString(), any());
		verify(this.deleter).deleteOrRecord(List.of(key.getValue()));
		assertThat(this.taro.getAvatarKey()).isEqualTo("avatars/old.png");
	}

	// S3 に置けなければ 500 にし、データベースは変えない
	@Test
	void S3に置けなければアバターは変わらない() {
		doThrow(SdkClientException.create("S3 につながらない")).when(this.storage).put(anyString(), anyString(), any());

		assertThatThrownBy(() -> this.service.changeAvatar(TARO, TestImages.png(300, 200)))
			.isInstanceOf(SdkClientException.class);

		verify(this.users, never()).findByIdForUpdate(TARO);
		verify(this.deleter, never()).deleteOrRecord(any());
	}

	// TC-02-1
	@Test
	void 形式が違えばS3に置かない() {
		assertApiError(() -> this.service.changeAvatar(TARO, TestImages.gif(10, 10)), ErrorCode.AVATAR_INVALID, "file");
		verify(this.storage, never()).put(anyString(), anyString(), any());
	}

	@Test
	void 大きすぎればS3に置かない() {
		assertApiError(() -> this.service.changeAvatar(TARO, new byte[5 * 1024 * 1024 + 1]), ErrorCode.AVATAR_TOO_LARGE,
				"file");
		verify(this.storage, never()).put(anyString(), anyString(), any());
	}

	// TC-02-3
	@Test
	void 外すと記録を消してから前のものを消す() {
		this.taro.changeAvatar("avatars/old.png", TestEntities.NOW);
		when(this.users.findByIdForUpdate(TARO)).thenReturn(Optional.of(this.taro));

		assertThat(this.service.removeAvatar(TARO).avatarUrl()).isNull();

		assertThat(this.taro.getAvatarKey()).isNull();
		verify(this.deleter).deleteOrRecord(List.of("avatars/old.png"));
	}

}
