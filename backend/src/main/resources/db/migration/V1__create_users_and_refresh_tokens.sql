-- ユーザー（データ設計書 4.1）。退会はないので、ユーザーの行は消さない（データ設計書 方針 7）
CREATE TABLE users (
    id                 bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username           varchar(15)  NOT NULL,
    display_name       varchar(30)  NOT NULL,
    password_hash      varchar(100) NOT NULL,
    avatar_key         varchar(200),
    status_emoji       varchar(64),
    status_text        varchar(100),
    status_expires_at  timestamptz,
    failed_login_count smallint     NOT NULL DEFAULT 0,
    locked_until       timestamptz,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now()
);

-- ユーザー ID は大文字・小文字を区別せずに重複させない（A-2）
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));

-- リフレッシュトークン（データ設計書 4.11）。トークンそのものではなく SHA-256 のハッシュだけを持つ
CREATE TABLE refresh_tokens (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    bigint      NOT NULL REFERENCES users (id),
    token_hash char(64)    NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- その人のリフレッシュトークンをすべて無効にする・期限切れをまとめて消す（BR-11）
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);
