-- 性能テスト（開発計画書 2-2、基本設計書 2.4）のデータ。要件定義書 11.1 の測定の条件の量を入れる：
-- ユーザー 1,000 人・ワークスペース 100・メッセージ 50 万件（うちスレッドの返信 10 万件）・リアクション 20 万件・
-- 添付 2 万件・メンション 5 万件。測るワークスペース（ID 900000001）はメンバー 200 人・チャンネル 50・メッセージ 10 万件。
-- ユーザー ID はすべて「perf_」で始まり、パスワードは perf-pass1。前回のデータは消してから入れ直す（何回流しても同じ形になる）。
--
-- 測るワークスペースの ID と会話の ID は決めて入れる（測るときに指定するため。perf/k6/lib.js・frontend/perf/measure.ts）：
--   ワークスペース 900000001「性能テスト」。オーナーは perf_0001、メンバーは perf_0001〜perf_0200
--   general 900000001（200 人）、チャンネル perf-ch-02〜perf-ch-50 は 900000002〜900000050（perf_0001〜perf_0100。
--   46〜50 はプライベート）、DM は perf_0001〜perf_0100 と、その 100 番後ろの人
--   general の最新のメッセージ 50 件に、画像の添付を 4 枚ずつ（200 枚。ファイルは frontend/perf/cli.ts が S3 に置く）
-- 本文は 40 個の言葉から 6 個を並べ、1,000 件に 1 件だけ「まれなさがしもの」を入れる（検索 N-5 の 3 文字以上の言葉）。
-- 表は API（Flyway）が作るので、先に API を起動しておく
BEGIN;

-- ワークスペースを消すと、会話・メッセージ・添付・リアクション・メンション・招待は ON DELETE CASCADE で一緒に消える。
-- LIKE だと「_」が 1 文字の記号になるので、先頭の 5 文字で比べる
DELETE FROM workspaces WHERE owner_id IN (SELECT id FROM users WHERE left(username, 5) = 'perf_');
DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE left(username, 5) = 'perf_');
DELETE FROM users WHERE left(username, 5) = 'perf_';

-- 乱数の種を決め、毎回同じデータにする（結果の表は出さない）
SELECT setseed(0.42) \g /dev/null

-- 検索の索引（V10）は、50 万件を入れてから作り直す（入れながら索引を更新すると何倍も遅いため）
DROP INDEX IF EXISTS messages_body_trgm_idx;

-- ユーザー 1,000 人。パスワード（perf-pass1）の BCrypt のハッシュは 1 つを使い回す（1,000 回計算すると遅いため）
INSERT INTO users (username, display_name, password_hash, created_at, updated_at)
SELECT format('perf_%s', lpad(n::text, 4, '0')),
       format('性能テスト %s', lpad(n::text, 4, '0')),
       '$2a$10$j6OIEMdIr/obCW25DF61ielNl3OX54GuohvdC5mKRKGqrUNe846fa',
       now() - interval '120 days',
       now() - interval '120 days'
FROM generate_series(1, 1000) AS n;

CREATE TEMP TABLE perf_users ON COMMIT DROP AS
SELECT id, row_number() OVER (ORDER BY username)::int AS n
FROM users WHERE left(username, 5) = 'perf_';
CREATE UNIQUE INDEX ON perf_users (n);

-- ワークスペース 100。1 番が測るワークスペース。2〜100 番のオーナーは 201 番より後ろの人
INSERT INTO workspaces (id, name, owner_id, created_at)
OVERRIDING SYSTEM VALUE
SELECT 900000000 + k,
       CASE WHEN k = 1 THEN '性能テスト' ELSE format('性能テスト %s', lpad(k::text, 3, '0')) END,
       (SELECT id FROM perf_users WHERE n = CASE WHEN k = 1 THEN 1 ELSE 200 + (k - 1) * 8 END),
       now() - interval '120 days'
FROM generate_series(1, 100) AS k;

-- メンバー。測るワークスペースは 1〜200 番。ほかは、オーナーと、201 番より後ろからランダムに 49 人
CREATE TEMP TABLE perf_members ON COMMIT DROP AS
SELECT 900000001::bigint AS workspace_id, u.id AS user_id, u.n
FROM perf_users u WHERE u.n <= 200
UNION
SELECT w.id, w.owner_id, (SELECT n FROM perf_users WHERE id = w.owner_id)
FROM workspaces w WHERE w.id BETWEEN 900000002 AND 900000100
UNION
SELECT w.id, u.id, u.n
FROM workspaces w
CROSS JOIN LATERAL (SELECT id, n FROM perf_users WHERE n > 200 ORDER BY random() LIMIT 49) u
WHERE w.id BETWEEN 900000002 AND 900000100;

INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
SELECT m.workspace_id, m.user_id, CASE WHEN w.owner_id = m.user_id THEN 'OWNER' ELSE 'MEMBER' END,
       now() - interval '120 days'
FROM perf_members m JOIN workspaces w ON w.id = m.workspace_id;

-- 会話。測るワークスペースは general と perf-ch-02〜perf-ch-50（ID を決める）と DM 100。
-- ほかのワークスペースは general と 4 つのチャンネル
INSERT INTO conversations (id, workspace_id, type, name, description, visibility, is_general, created_by, created_at)
OVERRIDING SYSTEM VALUE
SELECT 900000000 + c, 900000001, 'CHANNEL',
       CASE WHEN c = 1 THEN 'general' ELSE format('perf-ch-%s', lpad(c::text, 2, '0')) END,
       CASE WHEN c = 1 THEN '' ELSE '性能テストのチャンネルです' END,
       CASE WHEN c >= 46 THEN 'PRIVATE' ELSE 'PUBLIC' END,
       c = 1,
       (SELECT id FROM perf_users WHERE n = 1),
       now() - interval '120 days'
FROM generate_series(1, 50) AS c;

INSERT INTO conversations (workspace_id, type, name, description, visibility, is_general, created_by, created_at)
SELECT w.id, 'CHANNEL', CASE WHEN c = 1 THEN 'general' ELSE format('channel-%s', c) END, '', 'PUBLIC', c = 1,
       w.owner_id, now() - interval '120 days'
FROM workspaces w CROSS JOIN generate_series(1, 5) AS c
WHERE w.id BETWEEN 900000002 AND 900000100;

INSERT INTO conversations (workspace_id, type, dm_user_low, dm_user_high, created_by, created_at)
SELECT 900000001, 'DM', a.id, b.id, a.id, now() - interval '120 days'
FROM perf_users a JOIN perf_users b ON b.n = a.n + 100
WHERE a.n <= 100;

-- 会話のメンバー。general はワークスペースの全員、測るワークスペースのほかのチャンネルは 1〜100 番、
-- ほかのワークスペースのチャンネルは、ワークスペースのメンバーの約半分。DM は 2 人
INSERT INTO conversation_members (conversation_id, user_id, joined_at)
SELECT c.id, m.user_id, now() - interval '120 days'
FROM conversations c JOIN perf_members m ON m.workspace_id = c.workspace_id
WHERE c.type = 'CHANNEL' AND (
  c.is_general
  OR (c.workspace_id = 900000001 AND m.n <= 100)
  OR (c.workspace_id <> 900000001 AND random() < 0.5));

INSERT INTO conversation_members (conversation_id, user_id, joined_at)
SELECT c.id, u.user_id, now() - interval '120 days'
FROM conversations c CROSS JOIN LATERAL (VALUES (c.dm_user_low), (c.dm_user_high)) AS u (user_id)
WHERE c.type = 'DM' AND c.workspace_id = 900000001;

UPDATE workspace_members wm SET last_opened_conversation_id = c.id
FROM conversations c WHERE c.workspace_id = wm.workspace_id AND c.is_general;

-- 親メッセージ 40 万件。測るワークスペースに 8 万件（general 2 万 4 千・チャンネル 49 に 1,100 件ずつ・DM 100 に 21 件ずつ）、
-- ほかのワークスペースに 32 万件（1 つに 3,232 件くらい）。送った人は、その会話のメンバーからランダムに選ぶ。
-- 日時は 10 秒おき（約 46 日分）で、古い順に入れて ID の順と日時の順をそろえる
CREATE TEMP TABLE perf_words (i int, word text) ON COMMIT DROP;
INSERT INTO perf_words
SELECT ordinality::int, word FROM unnest(ARRAY[
  'あした', '会議', '資料', '確認', 'お願い', 'ありがとう', '旅行', '予定', '天気', '昼ごはん',
  '駅前', '集合', '写真', '動画', '共有', '締め切り', '修正', 'レビュー', '計画', '相談',
  '週末', '映画', '音楽', 'カフェ', '電車', '遅れ', '到着', '出発', '準備', '完了',
  '問題', '解決', 'テスト', 'リリース', '連絡', '返信', '了解', 'よろしく', 'おつかれさま', '休憩'
]) WITH ORDINALITY AS t (word, ordinality);

CREATE TEMP TABLE perf_slots ON COMMIT DROP AS
SELECT c.id AS conversation_id, s
FROM conversations c CROSS JOIN LATERAL generate_series(1, CASE
  WHEN c.id = 900000001 THEN 24000
  WHEN c.workspace_id = 900000001 AND c.type = 'CHANNEL' THEN 1100
  WHEN c.workspace_id = 900000001 THEN 21
  WHEN c.is_general THEN 1232
  ELSE 500 END) AS s;

CREATE TEMP TABLE perf_parents ON COMMIT DROP AS
SELECT row_number() OVER (ORDER BY random())::int AS n, conversation_id FROM perf_slots;

CREATE TEMP TABLE perf_conversation_users ON COMMIT DROP AS
SELECT conversation_id, array_agg(user_id ORDER BY user_id) AS users FROM conversation_members GROUP BY conversation_id;

-- 本文：6 個の言葉。1,000 件に 1 件は「まれなさがしもの」、10 件に 1 件はメンション（あとで mentions に記録する）
CREATE OR REPLACE FUNCTION pg_temp.perf_body(n int) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(w.word, '、') || CASE WHEN n % 1000 = 0 THEN ' まれなさがしもの' ELSE '' END
  FROM (SELECT 1 + floor(random() * 40)::int AS i FROM generate_series(1, 6)) r JOIN perf_words w ON w.i = r.i
$$;

INSERT INTO messages (conversation_id, user_id, client_id, body, created_at)
SELECT p.conversation_id,
       cu.users[1 + floor(random() * array_length(cu.users, 1))::int],
       gen_random_uuid(),
       pg_temp.perf_body(p.n),
       now() - (400001 - p.n) * interval '10 seconds'
FROM perf_parents p JOIN perf_conversation_users cu ON cu.conversation_id = p.conversation_id
ORDER BY p.n;

-- スレッドの返信 10 万件。DM 以外の親メッセージからランダムに選び（同じ親に何件も付くことがある）、親の 1〜60 分後に送ったことにする
CREATE TEMP TABLE perf_reply_parents ON COMMIT DROP AS
SELECT m.id, m.conversation_id, m.created_at
FROM messages m JOIN conversations c ON c.id = m.conversation_id
WHERE c.type = 'CHANNEL' AND m.user_id IN (SELECT id FROM perf_users);

INSERT INTO messages (conversation_id, user_id, parent_id, client_id, body, created_at)
SELECT p.conversation_id,
       cu.users[1 + floor(random() * array_length(cu.users, 1))::int],
       p.id,
       gen_random_uuid(),
       pg_temp.perf_body(1),
       p.created_at + (1 + floor(random() * 60)) * interval '1 minute'
FROM (SELECT * FROM perf_reply_parents ORDER BY random() LIMIT 100000) p
JOIN perf_conversation_users cu ON cu.conversation_id = p.conversation_id
ORDER BY 6;

UPDATE messages m SET reply_count = r.count, last_reply_at = r.last
FROM (SELECT parent_id, count(*) AS count, max(created_at) AS last FROM messages
      WHERE parent_id IS NOT NULL GROUP BY parent_id) r
WHERE m.id = r.parent_id;

-- メンション 5 万件。親メッセージ 8 件に 1 件、送った人以外の会話のメンバーを 1 人メンションしたことにし、本文の先頭に書く。
-- ほとんどは読んだことにする（測る人の、測るワークスペースの未読のメンションは 0〜数件）
CREATE TEMP TABLE perf_mentions ON COMMIT DROP AS
SELECT m.id AS message_id, cu.users[1 + floor(random() * array_length(cu.users, 1))::int] AS user_id, m.created_at
FROM messages m JOIN perf_conversation_users cu ON cu.conversation_id = m.conversation_id
WHERE m.parent_id IS NULL AND m.id % 8 = 0;

INSERT INTO mentions (message_id, user_id, is_read, created_at)
SELECT pm.message_id, pm.user_id, random() < 0.98, pm.created_at
FROM perf_mentions pm JOIN messages m ON m.id = pm.message_id
WHERE pm.user_id <> m.user_id;

UPDATE messages m SET body = format('@%s %s', u.username, m.body)
FROM mentions mn JOIN users u ON u.id = mn.user_id
WHERE mn.message_id = m.id AND left(u.username, 5) = 'perf_';

-- リアクション 20 万件。メッセージをランダムに選び、会話のメンバーが 10 種類の絵文字のどれかを付ける
INSERT INTO reactions (message_id, user_id, emoji, created_at)
SELECT m.id, cu.users[1 + floor(random() * array_length(cu.users, 1))::int],
       (ARRAY['👍', '🎉', '😂', '❤️', '🙏', '👀', '✅', '🔥', '😊', '💯'])[1 + floor(random() * 10)::int],
       m.created_at + interval '1 minute'
FROM (SELECT id, conversation_id, created_at FROM messages ORDER BY random() LIMIT 200000) m
JOIN perf_conversation_users cu ON cu.conversation_id = m.conversation_id
ON CONFLICT DO NOTHING;

-- 添付 2 万件（画像）。測るワークスペースの general の最新 50 件に 4 枚ずつ（ファイルは S3 に置く）。
-- 残りは、ほかのワークスペースのメッセージに 1 枚ずつ（測るときに開かないので、ファイルは置かない）
INSERT INTO attachments (conversation_id, uploader_id, message_id, status, kind, content_type, byte_size, file_name,
                         storage_key, thumbnail_key, width, height, sort_order, created_at)
SELECT m.conversation_id, m.user_id, m.id, 'READY', 'IMAGE', 'image/png', :image_bytes,
       format('perf-%s.png', lpad(g.i::text, 3, '0')),
       format('workspaces/900000001/attachments/perf-%s', lpad(((m.rn - 1) * 4 + g.i)::text, 3, '0')),
       format('workspaces/900000001/attachments/perf-%s-thumb', lpad(((m.rn - 1) * 4 + g.i)::text, 3, '0')),
       :image_width, :image_height, g.i - 1, m.created_at
FROM (SELECT id, conversation_id, user_id, created_at, row_number() OVER (ORDER BY id DESC)::int AS rn
      FROM messages WHERE conversation_id = 900000001 AND parent_id IS NULL ORDER BY id DESC LIMIT 50) m
CROSS JOIN generate_series(1, 4) AS g (i);

INSERT INTO attachments (conversation_id, uploader_id, message_id, status, kind, content_type, byte_size, file_name,
                         storage_key, thumbnail_key, width, height, sort_order, created_at)
SELECT m.conversation_id, m.user_id, m.id, 'READY', 'IMAGE', 'image/png', :image_bytes, 'photo.png',
       format('workspaces/%s/attachments/perf-x-%s', c.workspace_id, m.id),
       format('workspaces/%s/attachments/perf-x-%s-thumb', c.workspace_id, m.id),
       :image_width, :image_height, 0, m.created_at
FROM (SELECT id, conversation_id, user_id, created_at FROM messages
      WHERE parent_id IS NULL AND conversation_id NOT IN (SELECT id FROM conversations WHERE workspace_id = 900000001)
      ORDER BY random() LIMIT 19800) m
JOIN conversations c ON c.id = m.conversation_id;

-- 既読の位置。ほとんどの会話は最後まで読んだことにする。測るワークスペースの 1〜100 番は、
-- perf-ch-02〜perf-ch-10 を 5 件読んでいないことにする（サイドバーの太字と、未読を数える量）
UPDATE conversation_members cm SET last_read_message_id = x.last
FROM (SELECT conversation_id, max(id) AS last FROM messages WHERE parent_id IS NULL GROUP BY conversation_id) x
WHERE x.conversation_id = cm.conversation_id;

UPDATE conversation_members cm SET last_read_message_id = x.before
FROM (SELECT conversation_id, id AS before
      FROM (SELECT conversation_id, id, row_number() OVER (PARTITION BY conversation_id ORDER BY id DESC) AS r
            FROM messages WHERE parent_id IS NULL AND conversation_id BETWEEN 900000002 AND 900000010) t
      WHERE r = 6) x
WHERE x.conversation_id = cm.conversation_id;

CREATE INDEX messages_body_trgm_idx ON messages USING gin (body gin_trgm_ops);

COMMIT;

ANALYZE;

SELECT (SELECT count(*) FROM users WHERE left(username, 5) = 'perf_') AS users,
       (SELECT count(*) FROM workspaces WHERE id >= 900000001) AS workspaces,
       (SELECT count(*) FROM messages) AS messages,
       (SELECT count(*) FROM messages WHERE parent_id IS NOT NULL) AS replies,
       (SELECT count(*) FROM reactions) AS reactions,
       (SELECT count(*) FROM attachments) AS attachments,
       (SELECT count(*) FROM mentions) AS mentions,
       (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.workspace_id = 900000001) AS measured_messages;
