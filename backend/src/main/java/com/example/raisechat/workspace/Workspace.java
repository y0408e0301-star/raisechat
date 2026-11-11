package com.example.raisechat.workspace;

import java.time.Instant;

import org.jspecify.annotations.Nullable;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

// ワークスペース（データ設計書 4.2）。名前とオーナーは変えない（FN-03 1 章）
@Entity
@Table(name = "workspaces")
public class Workspace {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private @Nullable Long id;

	@Column(nullable = false, updatable = false)
	private String name;

	// 作れる数を数えるのに使う（BR-5）。権限の確かめには workspace_members.role を使う（データ設計書 方針 1）
	@Column(nullable = false, updatable = false)
	private long ownerId;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	protected Workspace() {
		this("", 0, Instant.EPOCH);
	}

	public Workspace(String name, long ownerId, Instant now) {
		this.name = name;
		this.ownerId = ownerId;
		this.createdAt = now;
	}

	public long getId() {
		if (this.id == null) {
			throw new IllegalStateException("まだ保存していないワークスペースです");
		}
		return this.id;
	}

	public String getName() {
		return this.name;
	}

	public long getOwnerId() {
		return this.ownerId;
	}

}
