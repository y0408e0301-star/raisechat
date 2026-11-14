package com.example.raisechat.attachment;

import static com.example.raisechat.ApiAssertions.assertApiError;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.example.raisechat.TestEntities;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.conversation.Conversation;
import com.example.raisechat.conversation.ConversationAccess;
import com.example.raisechat.conversation.ConversationRepository;
import com.example.raisechat.storage.FileStorage;
import com.example.raisechat.storage.StorageDeleter;
import com.example.raisechat.storage.TestImages;

// complete で、S3 の読み書きをしている間にアップロードが外されたとき（FN-09 5 章の 11）を、データベースを使わずに確かめる
@ExtendWith(MockitoExtension.class)
class AttachmentServiceTests {

	private static final long TARO = 1;

	private static final long UPLOAD = 77;

	private static final String KEY = "workspaces/3/attachments/a";

	@Mock
	AttachmentRepository attachments;

	@Mock
	ConversationAccess access;

	@Mock
	ConversationRepository conversations;

	@Mock
	FileStorage storage;

	@Mock
	StorageDeleter deleter;

	// 外した側（DELETE・片付け）は縮小した画像を知らないので、complete の側で消す
	@Test
	void 読み書きの間に外されたら作った縮小した画像を消して404() {
		AttachmentService service = new AttachmentService(this.attachments, this.access, this.conversations,
				this.storage, this.deleter, TestEntities.immediateTransaction(), TestEntities.fixedClock());
		byte[] image = TestImages.jpeg(2000, 1000);
		Attachment uploading = TestEntities.withId(
				new Attachment(10, TARO, AttachmentFormat.JPEG, image.length, "a.jpg", KEY, TestEntities.NOW), UPLOAD);
		when(this.attachments.findById(UPLOAD)).thenReturn(Optional.of(uploading));
		when(this.conversations.findVisible(TARO, 10))
			.thenReturn(Optional.of(TestEntities.withId(Conversation.general(3, TARO, TestEntities.NOW), 10)));
		when(this.storage.size(KEY)).thenReturn(OptionalLong.of(image.length));
		when(this.storage.readHead(eq(KEY), anyInt())).thenReturn(image);
		when(this.storage.read(KEY)).thenReturn(image);
		when(this.attachments.findByIdForUpdate(UPLOAD)).thenReturn(Optional.empty());

		assertApiError(() -> service.complete(TARO, UPLOAD), ErrorCode.UPLOAD_NOT_FOUND);

		verify(this.storage).put(eq(KEY + "-thumb.jpg"), anyString(), any());
		verify(this.deleter).deleteOrRecord(List.of(KEY + "-thumb.jpg"));
	}

}
