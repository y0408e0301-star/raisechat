-- メッセージ検索（データ設計書 8.3、FN-13 5 章の 4）。大文字・小文字を区別しない部分一致（ILIKE）を、本文の GIN の索引で速くする。
-- pg_trgm は PostgreSQL に含まれる拡張（技術スタック定義書 5.4）。データベースの LC_CTYPE が C だと日本語を索引に入れないので、
-- en_US.UTF-8 で作ったデータベースで使う
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX messages_body_trgm_idx ON messages USING gin (body gin_trgm_ops);
