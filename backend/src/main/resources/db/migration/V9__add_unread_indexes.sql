-- 未読・メンションの件数（データ設計書 8.2）のための索引。要件定義書 11.1 の件数で測って足した。
-- 会話の親メッセージだけ（未読はスレッドの返信を数えない。返信の多い会話でも返信を読まずに数える）
CREATE INDEX messages_conversation_parent_idx ON messages (conversation_id, id) WHERE parent_id IS NULL;
-- 読んでいないメンションだけ（件数は読んでいないものを数える）
CREATE INDEX mentions_unread_idx ON mentions (user_id) WHERE NOT is_read;
