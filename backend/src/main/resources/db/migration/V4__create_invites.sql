-- 招待リンク（データ設計書 4.4）。招待の文字列は、G-11 で何度でもコピーできるようそのまま持つ（FN-04 5 章の 2）
CREATE TABLE invites (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id bigint      NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    token        char(43)    NOT NULL,
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    created_by   bigint      NOT NULL REFERENCES users (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT invites_token_key UNIQUE (token)
);

-- 招待リンクの一覧（I-1）
CREATE INDEX invites_workspace_id_idx ON invites (workspace_id, id DESC);
-- 作ってから 30 日たったものをまとめて消す（BR-14）
CREATE INDEX invites_created_at_idx ON invites (created_at);
