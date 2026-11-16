# RaiseChat

Slack 風のチャットアプリ。ワークスペースを作り、その中のチャンネルとダイレクトメッセージで、テキスト・画像・動画をリアルタイムにやり取りする。スレッドでの返信、絵文字リアクション、メンション、メッセージの検索、未読とメンションの通知がある。チャンネルはメンバーなら誰でも作れ、ワークスペースを作った人（オーナー）は、招待・キック・チャンネルの削除ができる。

- 何を作るか：[要件定義書](docs/requirements/requirements.md)
- 文書の一覧：[docs/README.md](docs/README.md)
- 作る順番と進み具合：[開発計画書](docs/development-plan.md)
- 開発ルール：[CONTRIBUTING.md](CONTRIBUTING.md)

いまは要件定義書のすべての機能（開発計画書 1-1〜1-16）と、画面を通したテスト（2-1）まで作っています。公開の手順は、作ったときに足します。

## 起動方法

### 必要なもの

- JDK 21
- Node.js 24
- Docker Desktop

### 初回だけ

```
git clone https://github.com/y0408e0301-star/raisechat.git
cd raisechat
git config core.hooksPath .githooks
```

`git config core.hooksPath .githooks` は開発ルールを守らせる git フックを有効にする設定です（[CONTRIBUTING.md](CONTRIBUTING.md)）。

画面の部品を入れます（`frontend` で 1 回だけ。`package.json` が変わったときもやり直します）。

```
cd frontend
npm ci
```

### アバター・添付の置き場所（AWS S3）

アバター（FN-02）と、あとで作る添付（FN-09）は、開発中も本物の S3 の開発用バケット `rc-files-dev-467112307516`（東京リージョン、非公開）に置きます。API サーバーは AWS の鍵を AWS SDK の標準の探し方で見つけるので、開発する PC で `aws configure` を済ませ、`~/.aws/credentials` に、このバケットの `avatars/`・`workspaces/` を読み書きできる IAM ユーザーの鍵を置いておきます。

- 画面は API が発行した署名付き URL（1 時間。N-20）で S3 から直接読みます。バケットの URL を直接開いても 403 で見られません
- 自動のテスト（`mvnw verify`）は Testcontainers で MinIO（S3 の代わり。`chainguard/minio`）を起動するので、AWS の鍵は要りません
- S3 から消せなかったファイルは storage_deletions の表に記録し、毎日 4:30 に消し直します
- 確かめるためにバケットに置いたファイルは、確かめ終わったら消します（開発計画書 5 章）

### 起動する

ターミナルを使い、リポジトリのフォルダから次を順に実行します。

| 順番 | 起動するもの | コマンド | ポート |
| --- | --- | --- | --- |
| 1 | データベース | `docker compose up -d` | 5432（PostgreSQL） |
| 2 | API サーバー | `cd backend` → `.\mvnw.cmd spring-boot:run` | 8080 |
| 3 | 画面 | 別のターミナルで `cd frontend` → `npm run dev` | 5173 |

ブラウザで http://localhost:5173 を開きます。画面の dev サーバーは `/api` へのリクエストを API サーバー（8080）へ転送するので、画面と API は同じ場所（localhost:5173）にあるように見え、ログインの Cookie がそのまま使えます。

- API サーバーは http://localhost:8080/actuator/health で `{"status":"UP"}` が返れば起動済みです
- API の仕様書は http://localhost:8080/swagger-ui.html （Swagger UI）で見られます（下の「API の仕様書」）
- ポートは上の表のものだけを使います（[CLAUDE.md](CLAUDE.md) の「サーバーのポート」）。使われていたら、そのポートを使っているプロセスを止めてから起動し直します（別のポートでは起動しません）。ほかのアプリ（BookLog など）の PostgreSQL のコンテナが 5432 を使っていたら、`docker stop <コンテナ名>` で止めてから起動します
- 開発では、データベースの接続先・JWT の秘密の値・画面の URL（WebSocket の Origin の確かめに使う）・S3 のバケットは `backend/src/main/resources/application.properties` の既定値（開発用）を使うので、設定は要りません（S3 の鍵は上の「アバター・添付の置き場所」）。公開環境では環境変数（`DB_URL`・`DB_USERNAME`・`DB_PASSWORD`・`JWT_SECRET`・`COOKIE_SECURE=true`・`WEB_ORIGIN`・`S3_BUCKET`）で渡します
- 画面の dev サーバー（5173）は、`/api` と WebSocket の `/ws` を API サーバー（8080）へ転送します

### 止める

- API サーバー・画面：それぞれのターミナルで `Ctrl + C`
- データベース：`docker compose down`（データは残ります）

## テストとコードチェック

| 対象 | コマンド | 内容 |
| --- | --- | --- |
| API サーバー | `backend` で `.\mvnw.cmd verify` | テスト（下の「API サーバーのテストの種類」）、書式チェック（spring-javaformat。直すときは `.\mvnw.cmd spring-javaformat:apply`）、静的解析（SpotBugs）。API の仕様書（docs/api/openapi.yaml）がコードと違えば、書き直して失敗する |
| 画面 | `frontend` で `npm run lint` → `npm test` → `npm run build` | lint（oxlint。React Hooks の決まり・アクセシビリティを含む）、テスト（Vitest・Testing Library。下の「画面のテスト」）、型チェックとビルド |
| 画面を通したテスト | `frontend` で `npm run test:e2e` | Playwright で、2 人分のブラウザでの主な流れ・各機能のシナリオ・権限・ログインの続き・つなぎ直し・全画面のアクセシビリティと横幅を画面から確かめる（下の「画面を通したテスト」） |

Pull Request を作ったときは、GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）が上の 3 つと、画面の API の型が仕様書と同じかを自動で確かめます。あわせて、Claude Code が差分をレビューしてコメントします（[.github/workflows/claude-code-review.yml](.github/workflows/claude-code-review.yml)）。

### API サーバーのテストの種類

`mvnw verify` で、次の 5 種類をまとめて実行します。落ちたテストの種類で、どの層に原因があるかが分かります。

| 種類 | クラス名 | 確かめること | 本物を使うもの | 偽物にするもの |
| --- | --- | --- | --- | --- |
| 小さなクラスのテスト | `DisplayNamesTests`・`UserTests` など | 入力の条件と境界値 | そのクラスだけ | なし |
| Service のテスト | `*ServiceTests` | 処理の順番とエラー | Service | Repository・時計（Mockito） |
| Repository のテスト | `*RepositoryTests`（`@RepositoryTest`） | SQL の結果、テーブルの制約 | PostgreSQL（Flyway でテーブルを作る） | なし（Controller・Service は動かさない） |
| Controller のテスト | `*ControllerTests`（`@ControllerTest`） | URL・ステータス・JSON の形、ログインと CSRF トークンが要るか、エラーの形 | Controller・ログインの確かめ方（SecurityConfig） | Service（`@MockitoBean`） |
| API のテスト | `*ApiTests` | 機能定義書 10 章の観点を、API を通して（Controller から DB まで） | すべて | なし |

- **開発用の DB（compose.yaml）と S3 の開発用バケットは使いません。** DB を使うテストは、Testcontainers が使い捨ての PostgreSQL 17 を、API のテストは S3 の代わりの MinIO も Docker で起動し、終わったら消します。Docker は動かしておいてください
- H2 などのメモリーの DB は使いません。PostgreSQL にしかない機能を本番と同じ形で確かめるためです
- Controller のテストで、ログインした状態は `ControllerTestSupport.loggedIn(ユーザーの ID)` で作ります。spring-security-test の `jwt()` は CSRF の確認を飛ばすため使いません（本アプリは Cookie で JWT を送るので CSRF を確かめています）

### 画面のテスト

`npm test` で、`src` の `*.test.ts(x)` をまとめて実行します。API は呼ばず、`fetch` を偽物（`src/test/fetchMock.ts`）にして、決めた応答を返します。

| 種類 | ファイル | 確かめること |
| --- | --- | --- |
| 関数のテスト | `api.test.ts`・`validation.test.ts` | API の URL・メソッド・送る形、CSRF のヘッダー、JWT の取り直し（同時に 401 でも 1 回だけ）、入力の条件と境界値 |
| 部品のテスト | `components/*.test.tsx`・`auth/*.test.tsx` | ヘッダー・メニュー・ダイアログ・トースト・お知らせ欄・ログインの状態と移り先 |
| 画面のテスト | `pages/*.test.tsx`・`workspace/*.test.tsx`・`profile/*.test.tsx`・`attachments/*.test.tsx`・`App.test.tsx` | 機能定義書 10 章の観点のうち画面で確かめるもの（メッセージの出し方、押せる・押せない、移り先） |

- 絵文字の一覧（emoji-picker-element）は jsdom では動かないので、画面のテストでは選ぶボタンだけの偽物にします（`profile/profilePage.test.tsx`）
- 添付を S3 へ直接 PUT する XMLHttpRequest は、テストの中で偽物に替え、進み具合・成功・失敗をテストから起こします（`attachments/attachments.test.tsx`）

### 画面を通したテスト（E2E テスト）

[frontend/e2e](frontend/e2e) のテストは、Playwright でブラウザ（パソコンに入っている Microsoft Edge）を動かし、本物の API と DB につないで、利用者の操作の流れ（シナリオ）を確かめます。リアルタイムの通知は、2〜3 人のユーザーを別々のブラウザ（Cookie を分けたコンテキスト）で同時に開き、相手の画面に開き直さずに出ることを確かめます。

| ファイル | 確かめること |
| --- | --- |
| `main-flow.spec.ts` | 主な流れ（ワークスペースを作る → 招待リンク → ログインしていない人が登録して参加 → メッセージ・スレッド・リアクション・DM が相手に出る） |
| `channels.spec.ts` | 公開チャンネルの作成・G-8 で探して参加、プライベートチャンネルの招待・退出、オーナーの削除（M-28） |
| `messages.spec.ts` | 編集・削除とオーナーの削除、Markdown と HTML、メンションの候補・未読とメンションの件数・G-7、検索（M-43・M-44・位置を開く） |
| `members.spec.ts` | 招待リンクの取り消し（M-18）、キック（M-22）とまた参加したときの DM（M-36）、退出、ワークスペースの削除（M-15） |
| `attachments.spec.ts` | 画像の添付（縮小した画像・拡大・編集で外す・送れない形式）、リアクションの付け外し、プロフィール（表示名・ステータス・アバター） |
| `security.spec.ts` | ログインしていないと使えない、見られる範囲の外のデータを画面からも API からも取れない、オーナーだけの操作、CSRF、5 回の失敗でロック |
| `session.spec.ts` | JWT が切れてもリフレッシュトークンで使い続けられる、ログアウト後・使い回したリフレッシュトークンは使えない、インターネットが切れたとき（M-50）、WebSocket が切れたとき（M-37 とつなぎ直し・取りこぼしの取り直し） |
| `screens.spec.ts` | すべての画面（G-1〜G-18）に、アクセシビリティの違反（axe-core。WCAG 2.1 の A・AA）と横のスクロールがない |

画面の幅は 2 通りで動かします（[playwright.config.ts](frontend/playwright.config.ts) の projects）。`pc`（1280px）ではすべてを、`mobile`（375px。タッチの画面）では `main-flow.spec.ts` と `screens.spec.ts` を動かします。

使い方：

1. データベース・API サーバー・画面を「起動する」のとおりに起動します
2. `frontend` で `npm run test:e2e` を実行します（2〜3 分）。1 つのファイルだけなら `npm run test:e2e -- channels`、片方の幅だけなら `-- --project=pc`

- 行き先は既定で画面の Vite（5173）です。環境変数 `E2E_BASE_URL` で変えられます（CI は jar の 8080）
- 環境変数 `E2E_BROWSERS=all` を付けると、Edge に加えて Chrome・Firefox・WebKit（Safari の代わり）・iPhone と Android のエミュレーションでも流します（Firefox と WebKit は先に `npx playwright install firefox webkit`）
- テストは開発用の DB にユーザー（ID が `e2e_` で始まる）とワークスペースを作り、テストを始める前と終わった後に `docker compose exec` で DB から消します
- 添付・アバターを使うテストは、S3 の開発用のバケットにファイルを置きます。テストを始める前と終わった後に、テストのワークスペースの `workspaces/{ID}/` とテストのユーザーのアバターを `aws s3 rm` で消します（`aws configure` を済ませておきます）
- 落ちたテストは `frontend/test-results/` にトレースが残ります。`npx playwright show-trace <trace.zip のパス>` で、操作ごとの画面を見られます

### 画面も入れた jar

E2E の CI では、画面も入れた jar 1 つでアプリを動かします（公開先の画面は CloudFront が配るので、この jar の画面は使いません）。

1. `frontend` で `npm run build`
2. `backend` で `.\mvnw.cmd clean package -Pwith-frontend`（画面をビルドしていなければ止まります）
3. 環境変数 `WEB_ORIGIN=http://localhost:8080` を付けて `java -jar target\backend-0.0.1-SNAPSHOT.jar` で起動すると、http://localhost:8080/ で画面も使えます（API サーバーと同じ 8080 なので、開発用の API サーバーは止めておきます）。WebSocket の Origin が画面の URL と同じでないとつながらないため、`WEB_ORIGIN` を付けます

S3 の開発用バケットの CORS は http://localhost:5173 だけを許しているので、jar の画面から添付を送るには、CI と同じく MinIO（S3 の代わり）を使います（[.github/actions/start-app/action.yml](.github/actions/start-app/action.yml) と同じ手順。MinIO は 9000 で起動し、`S3_ENDPOINT`・`S3_ACCESS_KEY`・`S3_SECRET_KEY`・`S3_BUCKET` で接続先を渡します）。

## API の仕様書（OpenAPI）

仕様書は API のコード（Controller と record）から springdoc-openapi で作ります。手で直しません（[基本設計書 2.1](docs/design/basic-design.md#21-api-の詳細設計)）。

| 見たいもの | 方法 |
| --- | --- |
| 開発中に見る・試す | API サーバーを起動して http://localhost:8080/swagger-ui.html を開く。「Try it out」でログイン（`POST /api/auth/login`）すると、そのあとの API も Cookie と CSRF のヘッダー付きで試せる |
| ファイルで読む | [docs/api/openapi.yaml](docs/api/openapi.yaml) |

API を変えたときは、`backend` で `.\mvnw.cmd verify` を実行します。仕様書が変われば、`docs/api/openapi.yaml` を書き直してテストが失敗するので、もう一度実行して通ることを確かめます。続けて `frontend` で `npm run gen:api` を実行し、画面が使う API の型（`src/api-schema.d.ts`）を作り直してから、両方をコミットします。仕様書と Swagger UI は、公開環境では出しません（`mvnw spring-boot:run` で起動したときの dev プロファイルだけで出します）。

## ログ

API サーバーのログは、公開用の jar（`java -jar`）では 1 行 1 つの JSON（ECS 形式）で、開発中（`mvnw spring-boot:run`）は読みやすいテキストで出ます（[基本設計書 2.3](docs/design/basic-design.md#23-ログ)）。

- `/api/` のリクエストごとに `GET /api/auth/me 200 42ms` のような 1 行を出し、JSON ではリクエスト ID・ステータス・処理時間・ログインした人の ID を項目として持ちます
- リクエスト ID は応答のヘッダー `X-Request-Id` でも返します
- 5xx は ERROR、1 秒以上かかったリクエストは WARN で出します（閾値は `application.properties` の `app.logging.slow-request-threshold`）
- パスワード・JWT・Cookie・リクエストの本文・クエリ文字列は出しません
