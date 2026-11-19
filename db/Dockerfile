# 開発用・テスト用・CI の PostgreSQL。公式の postgres:17 に、メッセージ検索の索引に使う pg_bigm を足す
# （技術スタック定義書 5.4、データ設計書 8.3）。公開先の RDS には pg_bigm が入っているので、このイメージは使わない。
# pg_bigm の版は RDS for PostgreSQL 17.8 以降と同じ 1.2-20250903 にする。ソースはチェックサムで確かめる
FROM postgres:17 AS build
ARG PG_BIGM_VERSION=1.2-20250903
ARG PG_BIGM_SHA256=4d4fb48161e3f9e99207851299379c83b3e5d1d3c1a07c35f6a3153d577b3142
RUN apt-get update \
	&& apt-get install -y --no-install-recommends build-essential ca-certificates curl libicu-dev postgresql-server-dev-17 \
	&& curl -fsSL -o /tmp/pg_bigm.tar.gz "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz" \
	&& echo "${PG_BIGM_SHA256}  /tmp/pg_bigm.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/pg_bigm.tar.gz -C /tmp \
	&& make -C "/tmp/pg_bigm-${PG_BIGM_VERSION}" USE_PGXS=1 \
	&& make -C "/tmp/pg_bigm-${PG_BIGM_VERSION}" USE_PGXS=1 install DESTDIR=/out

FROM postgres:17
COPY --from=build /out/usr/lib/postgresql/17/lib/ /usr/lib/postgresql/17/lib/
COPY --from=build /out/usr/share/postgresql/17/extension/ /usr/share/postgresql/17/extension/
