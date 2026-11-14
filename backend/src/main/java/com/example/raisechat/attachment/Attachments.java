package com.example.raisechat.attachment;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import com.example.raisechat.common.ApiException;
import com.example.raisechat.common.ErrorCode;
import com.example.raisechat.storage.FileStorage;
import com.example.raisechat.storage.StorageDeleter;

// メッセージ（FN-07）・チャンネルとワークスペースの削除（FN-06・FN-03）から使う添付の操作（FN-09）。
// どれも呼ぶ側のトランザクションの中で使い、S3 のファイルはコミットの後で消す（BR-12）
@Component
public class Attachments {

	// 1 通に付けられる数（FN-09 4 章）
	public static final int MAX_PER_MESSAGE = 4;

	private final AttachmentRepository attachments;

	private final FileStorage storage;

	private final StorageDeleter deleter;

	Attachments(AttachmentRepository attachments, FileStorage storage, StorageDeleter deleter) {
		this.attachments = attachments;
		this.storage = storage;
		this.deleter = deleter;
	}

	// 送るメッセージに結びつける（FN-09 3.1）。自分がこの会話にアップロードし、complete を済ませ、
	// まだどのメッセージにも付いていないものだけ（9 章）。並び順は送られた順
	public List<AttachmentView> attach(long me, long conversationId, long messageId, List<Long> ids) {
		requireAtMostFour(ids);
		if (new HashSet<>(ids).size() != ids.size()) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "attachmentIds");
		}
		if (ids.isEmpty()) {
			return List.of();
		}
		Map<Long, Attachment> found = new LinkedHashMap<>();
		for (Attachment a : this.attachments.findAllByIdForUpdate(ids)) {
			found.put(a.getId(), a);
		}
		List<AttachmentView> views = new ArrayList<>();
		for (int i = 0; i < ids.size(); i++) {
			Attachment a = found.get(ids.get(i));
			if (a == null || a.getUploaderId() != me || a.getConversationId() != conversationId
					|| a.getStatus() != Attachment.Status.READY || a.getMessageId() != null) {
				throw new ApiException(ErrorCode.BAD_REQUEST, "attachmentIds");
			}
			a.attachTo(messageId, i);
			views.add(AttachmentView.of(a, this.storage));
		}
		return views;
	}

	public static void requireAtMostFour(@Nullable List<Long> ids) {
		if (ids != null && ids.size() > MAX_PER_MESSAGE) {
			throw new ApiException(ErrorCode.TOO_MANY_ATTACHMENTS, "attachmentIds");
		}
	}

	// メッセージごとの添付（並び順）。署名付き URL を入れる
	public Map<Long, List<AttachmentView>> views(Collection<Long> messageIds) {
		Map<Long, List<AttachmentView>> views = new LinkedHashMap<>();
		if (messageIds.isEmpty()) {
			return views;
		}
		for (Attachment a : this.attachments.findByMessageIds(messageIds)) {
			views.computeIfAbsent(a.getMessageId(), (id) -> new ArrayList<>()).add(AttachmentView.of(a, this.storage));
		}
		return views;
	}

	// 編集で外す（AT-9）。keep が null なら外さない。keep はそのメッセージの添付の ID だけ（足すことはできない）。
	// 残った数を返す
	public int keepOnly(long messageId, @Nullable List<Long> keep) {
		List<Attachment> current = this.attachments.findByMessageId(messageId);
		if (keep == null) {
			return current.size();
		}
		Set<Long> keepIds = new HashSet<>(keep);
		Set<Long> currentIds = new HashSet<>(current.stream().map(Attachment::getId).toList());
		if (keepIds.size() != keep.size() || !currentIds.containsAll(keepIds)) {
			throw new ApiException(ErrorCode.BAD_REQUEST, "keepAttachmentIds");
		}
		List<Attachment> removed = current.stream().filter((a) -> !keepIds.contains(a.getId())).toList();
		remove(removed);
		return current.size() - removed.size();
	}

	// メッセージを消すとき（MS-11。「削除されました」にするときも、データごと消すときも）
	public void removeAllOf(long messageId) {
		remove(this.attachments.findByMessageId(messageId));
	}

	// チャンネルを消すとき（CH-9）。行は会話と一緒に消える（ON DELETE CASCADE）ので、ファイルだけを消す
	public void deleteFilesOfConversation(long conversationId) {
		deleteFiles(this.attachments.findByConversationId(conversationId));
	}

	// ワークスペースを消すとき（W-6）
	public void deleteFilesOfWorkspace(long workspaceId) {
		deleteFiles(this.attachments.findByWorkspaceId(workspaceId));
	}

	private void remove(List<Attachment> removed) {
		if (removed.isEmpty()) {
			return;
		}
		this.attachments.deleteAll(removed);
		// 並び順の一意の索引が、続けて送る結びつけとぶつからないよう、ここで消しておく
		this.attachments.flush();
		deleteFiles(removed);
	}

	private void deleteFiles(List<Attachment> list) {
		this.deleter.deleteAfterCommit(list.stream().flatMap((a) -> a.storageKeys().stream()).toList());
	}

}
