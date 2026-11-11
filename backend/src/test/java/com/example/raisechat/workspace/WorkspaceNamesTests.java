package com.example.raisechat.workspace;

import static com.example.raisechat.ApiAssertions.assertApiError;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;

import com.example.raisechat.common.ErrorCode;

// ワークスペースの名前の条件（FN-03 4 章、TC-03-1）
class WorkspaceNamesTests {

	@Test
	void 前後の空白を取り除く() {
		assertThat(WorkspaceNames.valid(" 　仲間うち\t")).isEqualTo("仲間うち");
	}

	@ParameterizedTest
	@NullAndEmptySource
	@ValueSource(strings = { " ", "　\t" })
	void 空白だけは名前がないものとしてM11(String name) {
		assertApiError(() -> WorkspaceNames.valid(name), ErrorCode.WORKSPACE_NAME_REQUIRED, "name");
	}

	@Test
	void 一文字から五十文字まで_絵文字も一文字と数える() {
		assertThat(WorkspaceNames.valid("a")).isEqualTo("a");
		assertThat(WorkspaceNames.valid("😀".repeat(50))).hasSize(100);
		assertApiError(() -> WorkspaceNames.valid("😀".repeat(51)), ErrorCode.BAD_REQUEST, "name");
	}

	@Test
	void 途中に改行は入れられない() {
		assertApiError(() -> WorkspaceNames.valid("仲間\nうち"), ErrorCode.BAD_REQUEST, "name");
		assertApiError(() -> WorkspaceNames.valid("仲間\rうち"), ErrorCode.BAD_REQUEST, "name");
	}

}
