-- S3 から消せなかったファイル（データ設計書 4.12、BR-12）。1 日 1 回（4:30）消し直し、消せた行を消す。ふだんは 0 件
CREATE TABLE storage_deletions (
    id          bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    storage_key varchar(200) NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT storage_deletions_storage_key_key UNIQUE (storage_key)
);
