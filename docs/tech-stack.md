# 技術スタック定義書：チャットアプリ（RaiseChat）

| 項目 | 内容 |
| --- | --- |
| 文書番号 | RC-TECH |
| 版数 | 0.3 |
| 作成日 | 2026-11-10 |
| 最終更新日 | 2026-11-18 |
| 作成者 | （氏名） |
| 元にした文書 | [要件定義書](requirements/requirements.md) 版数 0.4、[機能定義書](functions/function-definition.md) 版数 0.1 |
| 状態 | 承認待ち |

## 改訂履歴

| 版数 | 日付 | 内容 | 作成者 |
| --- | --- | --- | --- |
| 0.1 | 2026-11-10 | 初版。BookLog と同じ技術・同じバージョンを基本にし、チャットに要るもの（WebSocket・Markdown・絵文字・画像の縮小）を足した | （氏名） |
| 0.2 | 2026-11-10 | インフラ設計書を作ったので、1 章からリンクした | （氏名） |
| 0.3 | 2026-11-18 | ブラウザの通知を Service Worker で出すことにした（#71。Android の Chrome は Notification のコンストラクタを受け付けないため） | （氏名） |

## 承認

| 役割 | 氏名 | 承認日 | 署名 |
| --- | --- | --- | --- |
| 承認者 | | | |
| 作成者 | | | |

---

## 1. 本書の目的

使う言語・フレームワーク・サービス・開発ツールとそのバージョンを決め、その理由を記録する。要件定義書の次の項目に対応する。

| 要件定義書 | 内容 |
| --- | --- |
| P-1 | データを保存する RDB（PostgreSQL）のバージョンと動かす場所を決める |
| P-2 | 添付・アバターを保存するクラウドストレージ（S3）と、自動のテストで使う代わり（MinIO）を決める |
| P-3 | リアルタイムの通信（WebSocket）の仕組みを、サーバーと画面の両方で決める |
| P-4 | 公開するときの AWS のサービスを決める。構成は[インフラ設計書](design/infra-design.md)に書く |

### 1.1 基本の方針

技術スタックは、前に作った読書記録アプリ（BookLog）と同じにする。**バージョンも BookLog と同じものを使う**。BookLog にないもの（リアルタイムの通信、Markdown の表示、絵文字、画像の縮小）だけを新しく選ぶ。BookLog との違いは 4 章にまとめる。

| 理由 | 内容 |
| --- | --- |
| 学習 | BookLog・Raise timeline で覚えたこと（JWT 認証・S3・ECS Fargate など）をそのまま使い、新しく学ぶことをリアルタイムの通信（WebSocket・STOMP）に絞る |
| 動作の実績 | BookLog で一緒に動くことを確かめた組み合わせなので、相性の問題が起きにくい |
| 保守 | 3 つのリポジトリで、バージョンを上げる作業を同じ手順で行える |

3 章のバージョンは、2026-11-10 時点で BookLog の pom.xml・package.json・compose.yaml・Dockerfile・Terraform・GitHub Actions で使っているものである。新しく足すものは、公開から 2 週間以上たった版を選ぶ。

---

## 2. 選定の条件

要件定義書と機能定義書から、使うものには次のことが求められる。

| No | 確認すること | 理由 |
| --- | --- | --- |
| 1 | RDB で、一意の制約・まとめて消す（ON DELETE CASCADE）・行のロックを使える | P-1、FN-03・FN-06・FN-10 |
| 2 | パスワードを BCrypt で保存でき、JWT の作成・確認を自分で一から作らなくてよい | N-18、N-24 |
| 3 | サーバーから画面へ、いつでもメッセージを送れる。宛先（本人あて・会話ごと）を分けられ、購読のときに権限を確かめられ、購読を取り消せる。切れたら自動でつなぎ直せる | P-3、N-3・N-4・N-9・N-15、機能定義書 4 章 |
| 4 | WebSocket でも、Cookie の JWT でログインを確かめ、接続元（Origin）を確かめられる | N-13、N-25 |
| 5 | 画面から S3 に直接アップロードできる（署名付きの PUT の URL を発行できる）。表示用の署名付き URL を発行できる | P-2、N-20、FN-09 |
| 6 | JPEG・PNG・GIF・WebP を読み、縮小した画像を作れる | FN-02 PF-2、FN-09 AT-5・AT-6 |
| 7 | Markdown 記法を、HTML として解釈させずに、決めた記法だけ飾りにして出せる | FN-07 MS-6・MS-7、N-21 |
| 8 | 絵文字を一覧から選べ（日本語の名前で探せる）、サーバーでも同じ版の一覧で確かめられる | FN-10 の 4 章 |
| 9 | 日本語の部分一致の検索が、要件定義書 11.1 の件数で 2 秒以内に終わる | N-5、FN-13 |
| 10 | 画面と API の両方で自動テストを書け、リアルタイムの通信も含めて GitHub Actions で動かせる | N-35 |
| 11 | スマートフォンの幅でも使える画面を作れる | N-29 |

---

## 3. 使う技術とバージョン

「BL」の列：○ は BookLog と同じもの・同じバージョン、新 は本アプリで新しく足すもの。

### 3.1 API（バックエンド）

| 区分 | 使うもの | バージョン | BL | 用途・理由 |
| --- | --- | --- | --- | --- |
| 言語 | Java | 21 | ○ | 長期サポート版 |
| フレームワーク | Spring Boot | 4.1.1 | ○ | spring-boot-starter-parent で指定 |
| Web | Spring Boot Starter Web MVC | Spring Boot 4.1.1 に合わせる | ○ | API |
| リアルタイムの通信 | Spring Boot Starter WebSocket（Spring の STOMP と、メモリの中の簡単な配信の仕組み（simple broker）） | 同上 | 新 | 条件 3。本人あて（/user/queue/events）と会話ごと（/topic/conversations/{id}）の宛先を分けられる。API のコンテナは 1 つなので（P-4）、外部の配信の仕組み（RabbitMQ など）は要らない |
| WebSocket の権限 | Spring Security Messaging（spring-security-messaging） | 同上 | 新 | 条件 3・4。購読（SUBSCRIBE）のときに、その会話を見られるかを確かめる |
| データベースの読み書き | Spring Boot Starter Data JPA（Hibernate） | 同上 | ○ | 一覧・未読の件数をまとめて取る SQL は @Query で書く。jOOQ は使わない |
| 表の作成・変更 | Flyway（spring-boot-starter-flyway・flyway-database-postgresql） | 同上 | ○ | 表の変更の履歴をリポジトリに残す |
| データベースの接続 | PostgreSQL JDBC Driver | 同上 | ○ | |
| ログイン・権限 | Spring Boot Starter Security | 同上 | ○ | BCrypt・CSRF 対策・権限の確認（条件 2）。セッションは使わない（STATELESS） |
| JWT の作成・確認 | Spring Boot Starter Security OAuth2 Resource Server | 同上 | ○ | JWT（HS256）の作成と確認。Cookie から JWT を読むところだけを自分で書き、/api と /ws の両方で使う（条件 4） |
| 画像の読み込み・縮小 | Java の標準（javax.imageio・java.awt）＋ TwelveMonkeys ImageIO（imageio-webp） | imageio-webp 3.15.3（2026-10-06 公開） | 新 | 条件 6。JPEG・PNG・GIF は Java の標準で読めるが、WebP は読めないため足す。縮小は Java の標準で行い、ほかのライブラリは使わない |
| 稼働の確認 | Spring Boot Starter Actuator | 同上 | ○ | 公開した後の稼働の確認（/actuator/health） |
| API の仕様書 | springdoc-openapi（springdoc-openapi-starter-webmvc-ui） | 3.1.1 | ○ | Controller・record から OpenAPI の仕様書を作る。公開先では出さない。WebSocket の通知の形は機能定義書 4 章で管理する |
| ログ | Spring Boot の構造化ログ（Logback。ECS 形式） | Spring Boot 4.1.1 に含まれる | ○ | 公開先ではログを JSON で出し、CloudWatch Logs Insights で探す |
| S3 の操作 | AWS SDK for Java 2.x（s3） | 2.56.0（BOM で固定） | ○ | 添付・アバターの保存・削除と、署名付きの GET・PUT の URL（S3Presigner。条件 5）。接続先を変えれば MinIO にも使える |
| 絵文字の一覧（サーバー） | Unicode の emoji-test.txt | Emoji 17.0 | 新 | 条件 8。リアクション・ステータスの絵文字が一覧にあるかを確かめる（FN-10 の 4 章）。ファイルを backend の resources に入れる。画面の一覧（3.2）と同じ版にする |
| ビルド | Maven | 3.9.16（Maven Wrapper 3.3.4） | ○ | mvnw をリポジトリに入れる |

「同上」は、バージョンを自分で書かず、Spring Boot 4.1.1 が決めるバージョンを使うという意味である。ファイルの形式の確かめ（先頭の数バイト。FN-09 の 5 章の 3）は、決まった並びを比べるだけなので自分で書き、ライブラリは使わない。

### 3.2 画面（フロントエンド）

| 区分 | 使うもの | バージョン | BL | 用途・理由 |
| --- | --- | --- | --- | --- |
| 実行環境 | Node.js | 24 | ○ | GitHub Actions の setup-node と同じ |
| 言語 | TypeScript | ~6.0.2 | ○ | |
| ライブラリ | React・React DOM | ^19.2.8 | ○ | |
| 開発サーバー・ビルド | Vite | ^8.3.0 | ○ | ポート 5173。/api と /ws を API（8080）へ中継する |
| Vite の React 対応 | @vitejs/plugin-react | ^6.1.1 | ○ | |
| 型定義 | @types/react・@types/react-dom・@types/node | ^19.2.18・^19.2.7・^24.13.3 | ○ | |
| 画面の切り替え | React Router（react-router） | 7.18.4 | ○ | 18 個の画面（G-1〜G-18）を URL で切り替える |
| 見た目 | CSS Modules | （Vite に含まれる） | ○ | 部品ごとに CSS を分けられ、追加のライブラリが要らない |
| STOMP の接続 | @stomp/stompjs | 7.5.0（2026-10-15 公開） | 新 | 条件 3。ブラウザの WebSocket の上で STOMP を使う。切れたときのつなぎ直し・ハートビート・購読と取り消しができる。依存するライブラリがない。SockJS は使わない（対応環境のブラウザはすべて WebSocket が使えるため） |
| Markdown の表示 | react-markdown ＋ remark-gfm | 10.1.0・4.0.1 | 新 | 条件 7。Markdown を React の部品に組み立てて出し、HTML の文字列を差し込まない（HTML のタグはそのまま文字になる）。出してよい要素（太字・斜体・取り消し線・コード・引用・箇条書き・リンク）を allowedElements で決め、それ以外は文字に戻す。リンクは http・https だけにする。取り消し線と URL の自動のリンクに remark-gfm を使う |
| 絵文字の一覧 | emoji-picker-element ＋ emoji-picker-element-data | 1.29.1・1.8.0（Emoji 17.0。emojibase-data 17.0.0 から作られたもの） | 新 | 条件 8。分類・検索・最近使ったもの・肌の色を持つ絵文字の一覧。日本語の名前（ja のデータ）で探せる。データはアプリと一緒に配り、外部の CDN から読まない。React からは Web Components として使う |
| ブラウザの通知 | ブラウザの Notification API と Service Worker | （ブラウザに含まれる） | 新 | FN-14 NT-7。ライブラリは使わない。通知は frontend/public/sw.js の Service Worker の showNotification() で出し、押したときもこの Service Worker がアプリのタブを前に出す（Android の Chrome は new Notification() を受け付けないため）。Service Worker を使えないとき（Firefox のプライベートウィンドウなど）は new Notification() で出す。Service Worker は画面のファイルの読み込み（fetch）には手を出さない |

バージョンは package.json に書く範囲である。実際に入るバージョンは package-lock.json で固定し、BookLog と同じものは BookLog の package-lock.json と同じ版にそろえる。

### 3.3 データベース・ストレージ

| 区分 | 開発環境 | AWS | BL | 用途・理由 |
| --- | --- | --- | --- | --- |
| データベース | PostgreSQL 17（Docker のイメージ postgres:17） | Amazon RDS for PostgreSQL 17 | ○ | 条件 1 |
| 部分一致の検索 | PostgreSQL の pg_trgm（GIN の索引） | 同じ（RDS で使える） | 新 | 条件 9。本文に索引を付け、大文字・小文字を区別しない部分一致（ILIKE）を速くする（5.4）。PostgreSQL に含まれる拡張なので、イメージを変えずに使える。pg_trgm は、データベースの文字の分類（LC_CTYPE）が C だと日本語の文字を索引に入れないため、データベースは LC_CTYPE を en_US.UTF-8 にして作る（postgres:17・Testcontainers・RDS の既定はこれ）。日本語の検索で索引が使われることを、API のテストで実行計画（EXPLAIN）を見て確かめる |
| 添付・アバターの保存先 | Amazon S3 の開発用のバケット。自動のテストでは MinIO（Docker のイメージ chainguard/minio。ダイジェストで固定） | Amazon S3 | ○ | 開発中は本番と同じ S3 で確かめる。テストは S3 と同じ API の MinIO を使い、AWS の鍵を GitHub に渡さない。画面からの直接のアップロードのため、バケットに CORS を設定する（FN-09 の 5 章の 9） |

### 3.4 外部のサービス

なし（BookLog の Google Books API のような外部の API は使わない）。

### 3.5 公開（AWS）

構成と費用はインフラ設計書に書く。BookLog の最後の構成と同じにし、WebSocket と画像の処理に合わせるところだけ変える。

| 区分 | 使うもの | バージョン・種類 | BL | 用途・理由 |
| --- | --- | --- | --- | --- |
| API の実行 | Amazon ECS（Fargate） | ARM64（Graviton）、**1 vCPU・メモリ 2GB**、タスク 1 つ | 一部 | サーバー（EC2）を持たずにコンテナで動かす。画像の縮小（10MB の画像を読み込む）と WebSocket の接続を持つため、BookLog（0.5 vCPU・1GB）より大きくする。この大きさは見込みで、インフラ設計書の費用の見積もりと性能テスト（要件定義書 11.1）で確かめ、足りなければ見直す。タスクは 1 つ（P-4） |
| API のイメージ | Docker（backend/Dockerfile）、Amazon ECR | ベースは amazoncorretto:21-al2023-headless（ダイジェストで固定） | ○ | 手元で作った jar を入れるだけ |
| データベース | Amazon RDS for PostgreSQL | 17、db.t4g.micro | ○ | |
| 入口・HTTPS | Amazon CloudFront、CloudFront Functions | PriceClass_200、cloudfront-js-2.0 | ○ | HTTPS の終端。画面を S3 から配る。/ws も CloudFront を通す（CloudFront は WebSocket を中継できる。設定はインフラ設計書） |
| ロードバランサー | Application Load Balancer | HTTP 80 | ○ | WebSocket を中継できる。止めている間は消す（P-5） |
| 添付・画面の保存先 | Amazon S3 | | ○ | P-2 |
| 外への通信 | なし（タスクから外部の API は呼ばない） | | — | |
| 秘密の値 | AWS Systems Manager Parameter Store | | ○ | N-23 |
| ログ・監視 | Amazon CloudWatch | | ○ | API のログ（JSON）、ALB・RDS のアラーム |
| 費用の通知 | AWS Budgets | | ○ | R-1 |
| AWS の構築 | Terraform | 1.16.5（required_version = ">= 1.9"） | ○ | 検収のたびに作って消すため |
| Terraform の AWS プロバイダー | hashicorp/aws | 6.68.0（version = "~> 6.0"） | ○ | |
| Terraform の乱数のプロバイダー | hashicorp/random | 3.9.1（version = "~> 3.6"） | ○ | DB のパスワード・JWT の秘密の値などを作る |
| Terraform の lint | TFLint ＋ tflint-ruleset-aws | ruleset 0.49.0 | ○ | |

### 3.6 開発ツール

| 区分 | 使うもの | バージョン | BL | 用途・理由 |
| --- | --- | --- | --- | --- |
| ソース管理 | Git・GitHub | | ○ | N-32 |
| 自動のチェック | GitHub Actions | actions/checkout@v7、actions/setup-node@v7、actions/setup-java@v6（temurin 21）、actions/upload-artifact@v7、hashicorp/setup-terraform@v4、terraform-linters/setup-tflint@v6 | ○ | N-35。Pull Request ごとに書式・lint・テスト・ビルドを動かす |
| 自動の PR レビュー | Claude Code（anthropics/claude-code-action@v1） | v1 | 新 | N-35。Pull Request ごとに差分をレビューし、本書・リポジトリのルールとの食い違いを見る（[.github/workflows/claude-code-review.yml](../.github/workflows/claude-code-review.yml)） |
| 開発用のコンテナ | Docker Compose | | ○ | PostgreSQL を起動する |
| API のテスト | JUnit 5、MockMvc、Testcontainers（PostgreSQL・MinIO） | Spring Boot 4.1.1 に合わせる | ○ | 本物の PostgreSQL と MinIO でテストする。開発用の DB は使わない。H2 は使わない |
| WebSocket のテスト | Spring の WebSocketStompClient（spring-websocket に含まれる） | Spring Boot 4.1.1 に合わせる | 新 | 条件 10。テストの中で本物の WebSocket でつなぎ、購読の権限（見られない会話は断られる）、通知の中身、キック・退出で購読が取り消されること（N-15）を確かめる |
| API の単体テスト | Mockito、@WebMvcTest、@DataJpaTest | Spring Boot 4.1.1 に合わせる | ○ | 層ごとに確かめる |
| 画面のテスト | Vitest | ^5.0.3 | ○ | |
| 画面の部品のテスト | Testing Library（@testing-library/react・user-event・jest-dom） | 16.3.3・14.6.8・7.0.1 | ○ | STOMP の接続は偽物に替えて、通知を受け取ったときの表示を確かめる |
| テストの中のブラウザ | jsdom | 30.1.3 | ○ | |
| 画面を通したテスト | Playwright（@playwright/test） | ^1.63.0 | ○ | 主な流れと各機能のシナリオ、375px の横幅を確かめる。リアルタイムの通信は、2 つのブラウザのコンテキスト（別の人）を同時に開いて確かめる。ブラウザはパソコンの Microsoft Edge。検収の対応環境の確認では Chrome・Firefox・WebKit と端末のエミュレーションでも流す |
| 画面のアクセシビリティの検査 | @axe-core/playwright | 4.13.0 | ○ | 全画面で WCAG 2.1 の A・AA の違反がないかを確かめる（N-27 など） |
| API の性能テスト | k6（Docker のイメージ grafana/k6） | 2.2.0 | ○ | 要件定義書 11.1 の目標を確かめる。k6 の WebSocket の機能で 50 人分の接続を作り、送ってから届くまで（N-3・N-4）を測る |
| Java の書式 | spring-javaformat | 0.0.48 | ○ | |
| Java の静的解析 | SpotBugs（spotbugs-maven-plugin） | 4.10.4.1 | ○ | |
| TypeScript の lint | oxlint | ^1.81.0 | ○ | |
| API の型の生成 | openapi-typescript | 7.13.0 | ○ | API の仕様書から画面の型を作る。WebSocket の通知の型は、機能定義書 4.3 を元に手で書く |
| エディタ | Visual Studio Code | | ○ | |

---

## 4. BookLog との違い

| 項目 | BookLog | 本アプリ | 理由 |
| --- | --- | --- | --- |
| リアルタイムの通信 | なし（画面を開いたときに読むだけ） | WebSocket・STOMP（Spring の simple broker、@stomp/stompjs） | 送ったメッセージをすぐ相手に出すため（P-3） |
| 外部の API | Google Books API（RestClient・jsoup） | なし | |
| 画像の保存 | 写真をそのまま保存 | 縮小した画像・切り取ったアバターを作る（TwelveMonkeys ImageIO で WebP を読む） | 一覧で軽く出すため（FN-09 AT-5、FN-02 PF-2） |
| アップロード | API サーバーが受け取る（multipart） | 画面から S3 に直接（署名付きの PUT）。アバターだけ API が受け取る | 100MB の動画で API サーバーを長く使わないため（FN-09） |
| 文章の表示 | 文字のまま | Markdown（react-markdown・remark-gfm） | FN-07 MS-6 |
| 絵文字 | なし | emoji-picker-element（画面）、emoji-test.txt（サーバー） | FN-10 |
| 部分一致の検索 | なし（本の検索は Google Books API） | pg_trgm | FN-13 |
| API のタスクの大きさ | 0.5 vCPU・1GB | 1 vCPU・2GB | 画像の縮小と WebSocket の接続のため |
| 自動の PR レビュー | なし | Claude Code | 2026-11-09 以降に作るリポジトリに入れると決めたため |
| 画面の数 | 13 画面 | 18 画面 | G-1〜G-18 |

---

## 5. 候補の比較

BookLog と同じものを使うことを前提にしたため、比較したのは新しく決めるものだけである。「2. 選定の条件」の No ごとに ○・△・× をつける。

### 5.1 リアルタイムの通信の方式

| 候補 | 3 | 4 | 10 | 備考 |
| --- | --- | --- | --- | --- |
| **WebSocket ＋ STOMP（Spring の simple broker）** | ○ | ○ | ○ | 採用。宛先（本人あて・会話ごと）と購読の仕組みが STOMP にあり、Spring Security で購読の権限を確かめられる。Spring の標準で、テスト用のクライアントもある |
| WebSocket をそのまま使い、宛先や購読を自分で作る | △ | ○ | △ | 宛先・購読・権限の確認・ハートビートを自分で作ることになり、作る量とまちがいが増える |
| Server-Sent Events（SSE） | △ | ○ | ○ | サーバーから画面への一方向だけで足りる（本アプリの送信は API で行う）。ただし、会話ごとの購読と取り消しを自分で作ることになる。HTTP/1.1 ではブラウザが同じサイトにつなげる数が 6 つまでで、タブを多く開くと足りなくなる |
| 外部のサービス（Pusher・AWS AppSync など） | ○ | △ | △ | 作る量は減るが、学習の目的（1.1）から外れ、費用と、外部のサービスとの間のログインの受け渡しが増える |

API のコンテナを複数にする場合は、simple broker の代わりに外部の配信の仕組み（RabbitMQ・Amazon MQ など）が要る。本アプリは 1 つにする（要件定義書 P-4、R-7）。

### 5.2 Markdown の表示

| 候補 | 7 | 備考 |
| --- | --- | --- |
| **react-markdown ＋ remark-gfm** | ○ | 採用。HTML の文字列を作らずに React の部品を組み立てるため、HTML として解釈させずに出せる。出す要素を allowedElements で決められる |
| marked など Markdown を HTML の文字列にするもの ＋ DOMPurify | △ | HTML の文字列を dangerouslySetInnerHTML で差し込むことになり、消毒（DOMPurify）の設定を誤るとスクリプトが動く |
| 自分で書く | △ | 記法は少ないが、入れ子（引用の中の箇条書きなど）とコードの扱いでまちがいやすい |

### 5.3 絵文字の一覧

| 候補 | 8 | 備考 |
| --- | --- | --- |
| **emoji-picker-element** | ○ | 採用。1 系で長く保守されている。日本語の名前で探せ、データを自分で配れる。React に依存しないため、React の版を上げても困らない |
| emoji-mart（@emoji-mart/react） | △ | React 用の部品の対応が React 18 まで（peerDependencies）で、2024 年から新しい版が出ていない |
| frimousse | △ | React 19 に対応しているが、0 系（0.4.0）で、まだ仕様が変わるおそれがある |

### 5.4 部分一致の検索

| 候補 | 9 | 備考 |
| --- | --- | --- |
| **pg_trgm（GIN の索引）** | ○ | 採用。PostgreSQL に含まれ、Docker の postgres:17 でも RDS でも追加の作業なしに使える。3 文字以上の言葉は索引で速く探せる。1〜2 文字の言葉は索引が効かず全件を読むが、1 つのワークスペースのメッセージ 10 万件なら 2 秒（N-5）に収まる見込み。k6 で確かめる |
| pg_bigm | ○ | 1〜2 文字の日本語にも索引が効くが、Docker の postgres:17 に含まれず、開発用・テスト用のイメージを自分で作ることになる |
| 索引なしの ILIKE | △ | 作るものは最も少ないが、件数が増えると遅くなる |
| Amazon OpenSearch Service | ○ | 数十人の利用には大きすぎ、費用もかかる |

### 5.5 画像の縮小

| 候補 | 6 | 備考 |
| --- | --- | --- |
| **Java の標準 ＋ TwelveMonkeys ImageIO（WebP を読む）** | ○ | 採用。Java の標準に WebP を読む機能を足すだけで、縮小は Java の標準で書ける |
| Thumbnailator | △ | 縮小を短く書けるが、WebP を読むにはやはり TwelveMonkeys が要る |
| 画面（ブラウザ）で縮小して送る | △ | サーバーの負担は減るが、画面から送られた縮小した画像が元の画像と同じものかを確かめられない |
| AWS Lambda で縮小する | ○ | API のタスクの負担は減るが、構成が増え、ローカルで動かしにくい |

---

## 6. 費用

AWS の月額の概算はインフラ設計書に書く。構築の前に AWS の料金を確かめ、ここに記録する。

| サービス | 項目 | 金額 | 確認日 | 確認した URL |
| --- | --- | --- | --- | --- |
| （構築前に記入） | | | | |
