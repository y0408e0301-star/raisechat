package com.example.raisechat.user;

import java.time.Instant;

import org.springframework.stereotype.Component;

import com.example.raisechat.storage.FileStorage;

// User を UserSummary にする。アバターがあれば署名付き URL（1 時間。FN-02 5 章の 4）を入れ、
// 消す時刻を過ぎたステータスは出さない（FN-02 5 章の 2）
@Component
public class UserSummaries {

	private final FileStorage storage;

	public UserSummaries(FileStorage storage) {
		this.storage = storage;
	}

	public UserSummary of(User user, Instant now) {
		String avatarKey = user.getAvatarKey();
		return new UserSummary(user.getUsername(), user.getDisplayName(),
				(avatarKey == null) ? null : this.storage.signedUrl(avatarKey), user.currentStatusEmoji(now),
				user.currentStatusText(now));
	}

}
