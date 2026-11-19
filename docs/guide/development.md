# 開発環境

手元で開発するための準備、起動と停止、API の仕様書、ログ。最短の手順は [README](../../README.md#動かし方) にある。

[README に戻る](../../README.md)・[ガイドの一覧](README.md)

## 必要なもの

- JDK 21
- Node.js 24
- Docker Desktop

## 初回だけ

```
git clone https://github.com/y0408e0301-star/raisechat.git
cd raisechat
git config core.hooksPath .githooks
```

`git config core.hooksPath .githooks` は開発ルールを守らせる git フックを有効にする設定です（[CONTRIBUTING.md](../../CONTRIBUTING.md)）。

画面の部品を入れます（`frontend` で 1 回だけ。`package.json` が変わったときもやり直します）。

```
cd frontend
npm ci
```

## アバター・添付の置き場所（AWS S3）

アバター（FN-02）と、あとで作る添付（FN-09）は、開発中も本物の S3 の開発用バケット `rc-files-dev-467112307516`（東京リージョン、非公開）に置きます。API サーバーは AWS の鍵を AWS SDK の標準の探し方で見つけるので、開発する PC で `aws configure` を済ませ、`~/.aws/credentials` に、このバケットの `avatars/`・`workspaces/` を読み書きできる IAM ユーザーの鍵を置いておきます。

- 画面は API が発行した署名付き URL（1 時間。N-20）で S3 から直接読みます。バケットの URL を直接開いても 403 で見られません
- 自動のテスト（`mvnw verify`）は Testcontainers で MinIO（S3 の代わり。`chainguard/minio`）を起動するので、AWS の鍵は要りません
- S3 から消せなかったファイルは storage_deletions の表に記録し、毎日 4:30 に消し直します
- 確かめるためにバケットに置いたファイルは、確かめ終わったら消します（開発計画書 5 章）

## 起動する

ターミナルを使い、リポジトリのフォルダから次を順に実行します。

| 順番 | 起動するもの | コマンド | ポート |
| --- | --- | --- | --- |
| 1 | データベース | `docker compose up -d`（初めてのときは、検索の索引の pg_bigm を足したイメージを作るので 1〜2 分かかります） | 5432（PostgreSQL） |
| 2 | API サーバー | `cd backend` → `.\mvnw.cmd spring-boot:run` | 8080 |
| 3 | 画面 | 別のターミナルで `cd frontend` → `npm run dev` | 5173 |

ブラウザで http://localhost:5173 を開きます。画面の dev サーバーは `/api` へのリクエストを API サーバー（8080）へ転送するので、画面と API は同じ場所（localhost:5173）にあるように見え、ログインの Cookie がそのまま使えます。

- API サーバーは http://localhost:8080/actuator/health で `{"status":"UP"}` が返れば起動済みです
- API の仕様書は http://localhost:8080/swagger-ui.html （Swagger UI）で見られます（この文書の「API の仕様書（OpenAPI）」）
- ポートは上の表のものだけを使います（[CLAUDE.md](../../CLAUDE.md) の「サーバーのポート」）。使われていたら、そのポートを使っているプロセスを止めてから起動し直します（別のポートでは起動しません）。ほかのアプリ（BookLog など）の PostgreSQL のコンテナが 5432 を使っていたら、`docker stop <コンテナ名>` で止めてから起動します
- 開発では、データベースの接続先・JWT の秘密の値・画面の URL（WebSocket の Origin の確かめに使う）・S3 のバケットは `backend/src/main/resources/application.properties` の既定値（開発用）を使うので、設定は要りません（S3 の鍵は上の「アバター・添付の置き場所」）。公開環境では環境変数（`DB_URL`・`DB_USERNAME`・`DB_PASSWORD`・`JWT_SECRET`・`COOKIE_SECURE=true`・`WEB_ORIGIN`・`S3_BUCKET`）で渡します
- 画面の dev サーバー（5173）は、`/api` と WebSocket の `/ws` を API サーバー（8080）へ転送します

## 止める

- API サーバー・画面：それぞれのターミナルで `Ctrl + C`
- データベース：`docker compose down`（データは残ります）

## API の仕様書（OpenAPI）

仕様書は API のコード（Controller と record）から springdoc-openapi で作ります。手で直しません（[基本設計書 2.1](../design/basic-design.md#21-api-の詳細設計)）。

| 見たいもの | 方法 |
| --- | --- |
| 開発中に見る・試す | API サーバーを起動して http://localhost:8080/swagger-ui.html を開く。「Try it out」でログイン（`POST /api/auth/login`）すると、そのあとの API も Cookie と CSRF のヘッダー付きで試せる |
| ファイルで読む | [docs/api/openapi.yaml](../api/openapi.yaml) |

API を変えたときは、`backend` で `.\mvnw.cmd verify` を実行します。仕様書が変われば、`docs/api/openapi.yaml` を書き直してテストが失敗するので、もう一度実行して通ることを確かめます。続けて `frontend` で `npm run gen:api` を実行し、画面が使う API の型（`src/api-schema.d.ts`）を作り直してから、両方をコミットします。仕様書と Swagger UI は、公開環境では出しません（`mvnw spring-boot:run` で起動したときの dev プロファイルだけで出します）。

## ログ

API サーバーのログは、公開用の jar（`java -jar`）では 1 行 1 つの JSON（ECS 形式）で、開発中（`mvnw spring-boot:run`）は読みやすいテキストで出ます（[基本設計書 2.3](../design/basic-design.md#23-ログ)）。

- `/api/` のリクエストごとに `GET /api/auth/me 200 42ms` のような 1 行を出し、JSON ではリクエスト ID・ステータス・処理時間・ログインした人の ID を項目として持ちます
- リクエスト ID は応答のヘッダー `X-Request-Id` でも返します
- 5xx は ERROR、1 秒以上かかったリクエストは WARN で出します（閾値は `application.properties` の `app.logging.slow-request-threshold`）
- パスワード・JWT・Cookie・リクエストの本文・クエリ文字列は出しません
