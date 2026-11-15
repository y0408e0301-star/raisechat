-- メンション（データ設計書 4.10）。1 通のメッセージで同じ人は 1 つだけ（MN-4）。
-- メッセージを消したら一緒に消える（「削除されました」にしたときは API が消す。BR-8）
CREATE TABLE mentions (
    message_id bigint      NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    user_id    bigint      NOT NULL REFERENCES users (id),
    is_read    boolean     NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);

-- 読んでいないメンションの件数（8.2）・メンションの一覧（NT-5）。データ設計書 6 章
CREATE INDEX mentions_user_message_idx ON mentions (user_id, message_id DESC);
