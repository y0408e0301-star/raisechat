package com.example.raisechat.conversation;

import org.jspecify.annotations.Nullable;

// G-8 のチャンネルの一覧の 1 行を読んだもの（ConversationRepository.findChannels）
interface ChannelRow {

	long getId();

	String getName();

	@Nullable String getDescription();

	String getVisibility();

	long getMemberCount();

	boolean getJoined();

}
