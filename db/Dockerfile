# 開発用・テスト用・CI の PostgreSQL。公式の postgres:17 に、メッセージ検索の索引に使う pg_bigm を足す
# （技術スタック定義書 5.4、データ設計書 8.3）。公開先の RDS には pg_bigm が入っているので、このイメージは使わない。
# pg_bigm の版は RDS for PostgreSQL 17.8 以降と同じ 1.2-20250903 にする
FROM postgres:17 AS build
ARG PG_BIGM_VERSION=1.2-20250903
RUN apt-get update \
	&& apt-get install -y --no-install-recommends build-essential ca-certificates curl libicu-dev postgresql-server-dev-17 \
	&& curl -fsSL "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz" | tar -xz -C /tmp \
	&& make -C "/tmp/pg_bigm-${PG_BIGM_VERSION}" USE_PGXS=1 \
	&& make -C "/tmp/pg_bigm-${PG_BIGM_VERSION}" USE_PGXS=1 install DESTDIR=/out

FROM postgres:17
COPY --from=build /out/usr/lib/postgresql/17/lib/ /usr/lib/postgresql/17/lib/
COPY --from=build /out/usr/share/postgresql/17/extension/ /usr/share/postgresql/17/extension/
