-- メッセージ検索の索引を pg_trgm から pg_bigm に替える（#75、データ設計書 8.3、技術スタック定義書 5.4）。
-- pg_trgm は 3 文字の組で引くので、1〜2 文字の言葉では索引が使えず、見つからない言葉だと全部の行を読んでいた。
-- pg_bigm は 2 文字の組で引くので、1〜2 文字の言葉でも索引で探せる。pg_bigm は ILIKE には効かないので、
-- 大文字・小文字を区別しないよう lower(body) に索引を作り、検索は lower(body) LIKE lower(言葉) にする。
-- pg_bigm は RDS にあり、開発用・テスト用は db/Dockerfile のイメージに入れている
CREATE EXTENSION IF NOT EXISTS pg_bigm;
CREATE INDEX messages_body_bigm_idx ON messages USING gin (lower(body) gin_bigm_ops);
DROP INDEX messages_body_trgm_idx;
DROP EXTENSION pg_trgm;
