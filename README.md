# RaiseChat

Slack 風のチャットアプリ。ワークスペースを作り、その中のチャンネルとダイレクトメッセージで、テキスト・画像・動画をリアルタイムにやり取りする。

## 主な機能

- ワークスペースの作成と、招待リンク（期限 7 日・取り消し可）での参加。オーナーはキック・チャンネルの削除ができる
- 公開・プライベートのチャンネルと、ダイレクトメッセージ
- メッセージの送信・編集・削除（Markdown）、スレッドでの返信、絵文字リアクション、メンション
- 画像（縮小した画像を作る）・動画の添付。ブラウザから S3 へ直接アップロードする
- 未読とメンションの件数、ブラウザの通知（WebSocket でリアルタイムに届く）
- メッセージの検索（1 文字から。日本語にも索引が効く）
- パソコンとスマートフォンの画面

## 使っている技術

| 区分 | 技術 |
| --- | --- |
| API | Java 21・Spring Boot 4.1・Spring Security（JWT を Cookie で）・Spring Data JPA・Flyway・WebSocket（STOMP） |
| 画面 | TypeScript・React 19・Vite・React Router・CSS Modules |
| データベース | PostgreSQL 17（検索の索引は pg_bigm） |
| 添付の置き場所 | Amazon S3（自動のテストでは MinIO） |
| テスト | JUnit・Testcontainers・Vitest・Testing Library・Playwright（E2E）・k6（性能） |
| 公開 | AWS（CloudFront・ALB・ECS Fargate・RDS・S3）を Terraform で作る |
| CI | GitHub Actions（テスト・書式・lint・E2E）と、Claude Code による Pull Request の自動レビュー |

選んだ理由と版は[技術スタック定義書](docs/tech-stack.md)にある。

## 開発の状況

[開発計画書](docs/development-plan.md)のすべて（要件定義書の全機能、E2E・性能テスト、公開、受け入れ）を終えている。受け入れの結果は[検収書](docs/test/acceptance-report.md)と[性能試験報告書](docs/test/performance-test-report.md)にある。公開環境は受け入れの後に消したので、いまは公開していない。

## 動かし方

JDK 21・Node.js 24・Docker Desktop を入れておく。添付・アバターを使うときは、開発用の S3 のバケットに読み書きできる AWS の鍵を `aws configure` で置く（[開発環境](docs/guide/development.md#アバター添付の置き場所aws-s3)）。

```
git clone https://github.com/y0408e0301-star/raisechat.git
cd raisechat
git config core.hooksPath .githooks        # 開発ルールを守らせる git フック（CONTRIBUTING.md）
cd frontend && npm ci && cd ..             # 画面の部品を入れる（初回だけ）
```

次の 3 つを、それぞれ別のターミナルで起動し、http://localhost:5173 を開く。

| 起動するもの | コマンド | ポート |
| --- | --- | --- |
| データベース | `docker compose up -d`（表は API の起動のときに Flyway が作る。初回はイメージを作るので 1〜2 分） | 5432 |
| API サーバー | `cd backend` → `.\mvnw.cmd spring-boot:run` | 8080 |
| 画面 | `cd frontend` → `npm run dev` | 5173 |

テストは `backend` で `.\mvnw.cmd verify`、`frontend` で `npm run lint`・`npm test`・`npm run build`・`npm run test:e2e`。

公開は Git Bash で `bash deploy/deploy.sh`（反映）・`bash deploy/start.sh`（起動）・`bash deploy/stop.sh`（停止）。初めて作るときの手順は[基本設計書 2.2.1](docs/design/basic-design.md#221-公開環境の手順)にある。

詳しい手順は[開発者向けガイド](docs/guide/README.md)にある。

| ガイド | 内容 |
| --- | --- |
| [開発環境](docs/guide/development.md) | 初回の準備、S3、起動と停止、開発の設定、API の仕様書、ログ |
| [テストとコードチェック](docs/guide/testing.md) | テストの種類、E2E、画面も入れた jar |
| [性能テスト](docs/guide/performance.md) | k6・Playwright での測り方 |
| [公開環境](docs/guide/deploy.md) | 反映・起動・停止のスクリプトと注意 |

## 文書

| 文書 | 内容 |
| --- | --- |
| [要件定義書](docs/requirements/requirements.md) | 何を作るか（機能・非機能要件・検収） |
| [機能定義書](docs/functions/function-definition.md) | 機能ごとの仕様（FN-01〜FN-14） |
| [基本設計書](docs/design/basic-design.md) | 画面・データ・インフラの設計 |
| [テスト仕様書](docs/test/test-specification.md) | テストの方針と結果 |
| [操作マニュアル](docs/manual/operation-manual.md) | 利用者向けの使い方 |
| [文書の一覧](docs/README.md) | すべての文書 |

開発ルール（Issue → ブランチ → Pull Request → 自動レビュー → squash マージ）は [CONTRIBUTING.md](CONTRIBUTING.md) にある。
