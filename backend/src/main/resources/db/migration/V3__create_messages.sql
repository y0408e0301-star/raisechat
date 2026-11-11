-- メッセージ（データ設計書 4.7）。会話のメッセージとスレッドの返信を 1 つの表に持つ。
-- varchar の長さは文字（コードポイント）で数えるので、本文は 4,000 文字まで
CREATE TABLE messages (
    id              bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id bigint        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    user_id         bigint        NOT NULL REFERENCES users (id),
    -- スレッドの返信のときだけ。親を消したら返信も一緒に消える（返信のある親は行を残すので、ふだんは消えない）
    parent_id       bigint        REFERENCES messages (id) ON DELETE CASCADE,
    client_id       uuid          NOT NULL,
    body            varchar(4000) NOT NULL DEFAULT '',
    reply_count     integer       NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
    last_reply_at   timestamptz,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    edited_at       timestamptz,
    -- 返信のある親メッセージを消したときだけ（データ設計書 方針 3）
    deleted_at      timestamptz,
    -- 同じ送信を 2 回追加しない（FN-07 5 章の 8）
    CONSTRAINT messages_user_client_key UNIQUE (user_id, client_id)
);

-- 会話のメッセージの一覧（MS-1・MS-2）、未読の件数（8.2）、会話の削除で一緒に消すとき。
-- 返信を除く条件は索引の外で絞る（部分索引にすると削除のときに使われないため。データ設計書 6 章）
CREATE INDEX messages_conversation_id_idx ON messages (conversation_id, id);
-- スレッドの返信の一覧（FN-08）
CREATE INDEX messages_parent_id_idx ON messages (parent_id, id) WHERE parent_id IS NOT NULL;
