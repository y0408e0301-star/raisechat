-- 添付ファイル（データ設計書 4.8）。アップロードを受け付けたときに 'UPLOADING' で追加し、complete で 'READY' にする。
-- 送るまでは message_id がない。会話・メッセージを消したら一緒に消える（S3 のファイルは API が消す。BR-12）
CREATE TABLE attachments (
    id              bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id bigint       NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    uploader_id     bigint       NOT NULL REFERENCES users (id),
    message_id      bigint       REFERENCES messages (id) ON DELETE CASCADE,
    status          varchar(10)  NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING', 'READY')),
    kind            varchar(10)  NOT NULL CHECK (kind IN ('IMAGE', 'VIDEO')),
    content_type    varchar(20)  NOT NULL CHECK (content_type IN
                        ('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm')),
    byte_size       bigint       NOT NULL,
    file_name       varchar(255) NOT NULL,
    storage_key     varchar(200) NOT NULL,
    thumbnail_key   varchar(200),
    width           integer,
    height          integer,
    sort_order      smallint     CHECK (sort_order BETWEEN 0 AND 3),
    created_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT attachments_storage_key_key UNIQUE (storage_key),
    -- 画像は 10MB、動画は 100MB まで（FN-09 4 章）
    CONSTRAINT attachments_byte_size_check CHECK (byte_size > 0 AND byte_size <= CASE kind
        WHEN 'IMAGE' THEN 10485760 ELSE 104857600 END),
    -- 送った添付だけが並び順を持つ
    CONSTRAINT attachments_sent_sort_order_check CHECK ((message_id IS NULL) = (sort_order IS NULL))
);

-- メッセージの添付を並び順で読む（データ設計書 6 章）
CREATE UNIQUE INDEX attachments_message_sort_key ON attachments (message_id, sort_order);
-- チャンネル・ワークスペースの削除で、消すファイルを読む
CREATE INDEX attachments_conversation_id_idx ON attachments (conversation_id);
-- 送らなかったものをまとめて消す（BR-13）
CREATE INDEX attachments_unsent_created_at_idx ON attachments (created_at) WHERE message_id IS NULL;
