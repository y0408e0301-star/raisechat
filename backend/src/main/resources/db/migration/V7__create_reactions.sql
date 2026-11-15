-- リアクション（データ設計書 4.9）。1 人が 1 つのメッセージに同じ絵文字を付けるのは 1 つだけ（FN-10 5 章の 1）。
-- メッセージを消したら一緒に消える（「削除されました」にしたときは API が消す。BR-8）
CREATE TABLE reactions (
    message_id bigint      NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    user_id    bigint      NOT NULL REFERENCES users (id),
    emoji      varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji)
);

-- メッセージのリアクションを付けた順に読む（RE-5。データ設計書 6 章）
CREATE INDEX reactions_message_created_at_idx ON reactions (message_id, created_at);
