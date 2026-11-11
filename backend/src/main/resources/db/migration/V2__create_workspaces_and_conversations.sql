-- ワークスペース（データ設計書 4.2）。オーナーは変えない
CREATE TABLE workspaces (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       varchar(50) NOT NULL,
    owner_id   bigint      NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 作れる数（10 個）を数える（BR-5）
CREATE INDEX workspaces_owner_id_idx ON workspaces (owner_id);

-- 会話（データ設計書 4.5）。チャンネルと DM を 1 つの表に持ち、種類ごとに使う列を CHECK 制約で決める
CREATE TABLE conversations (
    id           bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id bigint       NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    type         varchar(10)  NOT NULL CHECK (type IN ('CHANNEL', 'DM')),
    name         varchar(80),
    description  varchar(250),
    visibility   varchar(10)  CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
    is_general   boolean      NOT NULL DEFAULT false,
    dm_user_low  bigint       REFERENCES users (id),
    dm_user_high bigint       REFERENCES users (id),
    created_by   bigint       NOT NULL REFERENCES users (id),
    created_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT conversations_type_columns_check CHECK (
        (type = 'CHANNEL' AND name IS NOT NULL AND visibility IS NOT NULL
            AND dm_user_low IS NULL AND dm_user_high IS NULL)
        OR (type = 'DM' AND name IS NULL AND description IS NULL AND visibility IS NULL AND NOT is_general
            AND dm_user_low IS NOT NULL AND dm_user_high IS NOT NULL AND dm_user_low < dm_user_high)
    ),
    -- general は公開チャンネル（FN-06）
    CONSTRAINT conversations_general_public_check CHECK (NOT is_general OR visibility = 'PUBLIC')
);

-- 同じ名前のチャンネルを作らない（CH-2）・名前の順の一覧（CH-3）
CREATE UNIQUE INDEX conversations_channel_name_key ON conversations (workspace_id, lower(name))
    WHERE type = 'CHANNEL';
-- general はワークスペースごとに 1 つ
CREATE UNIQUE INDEX conversations_general_key ON conversations (workspace_id) WHERE is_general;
-- 同じ 2 人の DM は 1 つ（FN-12）、自分が小さい方の DM を探す（8.1）
CREATE UNIQUE INDEX conversations_dm_key ON conversations (workspace_id, dm_user_low, dm_user_high)
    WHERE type = 'DM';
-- 自分が大きい方の DM を探す（8.1）
CREATE INDEX conversations_dm_user_high_idx ON conversations (workspace_id, dm_user_high) WHERE type = 'DM';

-- ワークスペースのメンバー（データ設計書 4.3）
CREATE TABLE workspace_members (
    workspace_id                bigint      NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id                     bigint      NOT NULL REFERENCES users (id),
    role                        varchar(10) NOT NULL CHECK (role IN ('OWNER', 'MEMBER')),
    -- 最後に開いた会話（W-4）。会話が消されたらなしにする
    last_opened_conversation_id bigint      REFERENCES conversations (id) ON DELETE SET NULL,
    joined_at                   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

-- 自分のワークスペースの一覧（W-1）
CREATE INDEX workspace_members_user_id_idx ON workspace_members (user_id);
-- 会話を消したときになしにする（SET NULL）とき、全件を読まないため
CREATE INDEX workspace_members_last_opened_idx ON workspace_members (last_opened_conversation_id);
-- オーナーはワークスペースごとに 1 人
CREATE UNIQUE INDEX workspace_members_owner_key ON workspace_members (workspace_id) WHERE role = 'OWNER';

-- 会話のメンバー（データ設計書 4.6）。最後に読んだメッセージはメッセージが消えても困らないよう外部キーにしない
CREATE TABLE conversation_members (
    conversation_id      bigint      NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    user_id              bigint      NOT NULL REFERENCES users (id),
    last_read_message_id bigint      NOT NULL DEFAULT 0,
    joined_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

-- 自分が入っている会話（サイドバー・見られるか）
CREATE INDEX conversation_members_user_id_idx ON conversation_members (user_id, conversation_id);
