# 基本設計書：チャットアプリ（RaiseChat）

| 項目 | 内容 |
| --- | --- |
| 文書番号 | RC-BD |
| 版数 | 0.18 |
| 作成日 | 2026-11-10 |
| 最終更新日 | 2026-11-17 |
| 作成者 | （氏名） |
| 元にした文書 | [要件定義書](../requirements/requirements.md)（RC-REQ）版数 0.6、[機能定義書](../functions/function-definition.md)（RC-FD）版数 0.9、[技術スタック定義書](../tech-stack.md)（RC-TECH）版数 0.2 |
| 状態 | 承認待ち |

## 改訂履歴

| 版数 | 日付 | 内容 | 作成者 |
| --- | --- | --- | --- |
| 0.1 | 2026-11-10 | 初版。構成は BookLog の基本設計書と同じにした。画面設計書 0.1 を作成。データ設計書・インフラ設計書は次の版で足す | （氏名） |
| 0.2 | 2026-11-10 | データ設計書 0.1・インフラ設計書 0.1 を作成し、1.2 からリンクした。Q-2 を足した | （氏名） |
| 0.3 | 2026-11-11 | 画面設計書を 0.2 にした（2.14 の残りの文字数を出し始めるところ）。元にした機能定義書を 0.4 にした | （氏名） |
| 0.4 | 2026-11-12 | リアルタイムの通知を作ったので（開発計画書 1-5）、2.1 の通知の型の確かめ方と 2.3 の WebSocket のログの項目を具体的にした。元にした機能定義書を 0.5 にした | （氏名） |
| 0.5 | 2026-11-13 | 元にした機能定義書を 0.6 にした（FN-06 0.2） | （氏名） |
| 0.6 | 2026-11-13 | データ設計書を 0.2 にした（invites の索引）。元にした機能定義書を 0.7 にした（FN-04 0.2） | （氏名） |
| 0.7 | 2026-11-13 | 画面設計書を 0.3 にした（7.3 の workspace.removed）。元にした機能定義書を 0.8 にした（FN-03 0.2・FN-05 0.2） | （氏名） |
| 0.8 | 2026-11-13 | 元にした機能定義書を 0.9 にした（FN-12 0.2） | （氏名） |
| 0.9 | 2026-11-14 | 画面設計書を 0.4 にした（2.7・G-10・G-16）。元にした機能定義書を 0.10 にした（FN-02 0.2・FN-05 0.3・FN-10 0.2） | （氏名） |
| 0.10 | 2026-11-14 | 画面設計書を 0.5（2.12・2.14 の添付）、データ設計書を 0.3（4.8 の縮小した画像の置き場所と制約）、インフラ設計書を 0.2（添付のバケットの CORS）にした。元にした機能定義書を 0.11 にした（FN-07 0.3・FN-09 0.2） | （氏名） |
| 0.11 | 2026-11-14 | 元にした機能定義書を 0.12 にした（FN-08 0.3、MessageView の replyUsers） | （氏名） |
| 0.12 | 2026-11-16 | データ設計書を 0.4 にした（未読・メンションの件数の SQL を測って書き換え、索引を 2 つ足した）。元にした機能定義書を 0.15 にした（FN-14 0.4 ほか） | （氏名） |
| 0.13 | 2026-11-16 | データ設計書を 0.5 にした（検索の SQL と測った結果）。元にした機能定義書を 0.16 にした（FN-13 0.2） | （氏名） |
| 0.14 | 2026-11-16 | 性能テストを作ったので（開発計画書 2-2）、2.4 に測り方と手元で測った結果を書いた。N-5 は 1〜2 文字の言葉でも満たすので、検索の最小の文字数は設けない。データ設計書を 0.6 にした（8.3 の汎用の計画） | （氏名） |
| 0.15 | 2026-11-16 | 2.4 に、手元の MinIO で測った N-6・N-7 と、GitHub Actions のランナーで測った結果を足した（ランナーで N-6・N-7 が途中で止まったので、画面に出たかを待つ部品を直した） | （氏名） |
| 0.16 | 2026-11-17 | インフラ設計書を 0.3 にした（CloudFront から ALB へ渡すヘッダー） | （氏名） |
| 0.17 | 2026-11-17 | 反映・起動・停止のスクリプトを作ったので（開発計画書 2-4）、2.2 に運用の手順（2.2.1〜2.2.4）を書いた | （氏名） |
| 0.18 | 2026-11-17 | インフラ設計書を 0.4 にした（公開して確かめた結果、未決事項 4 の決定） | （氏名） |

## 承認

| 役割 | 氏名 | 承認日 | 署名 |
| --- | --- | --- | --- |
| 承認者 | | | |
| 作成者 | | | |

承認は、本書と 1.2 の詳細文書をまとめて行う。詳細文書を変えた場合は、その文書の版数を上げて改訂履歴に記録し、あわせて本書の版数を上げて改訂履歴に記録する。

---

## 1. 概要

### 1.1 本書の目的

要件定義書・機能定義書で決めた「何ができるか」をもとに、「画面がどう見えて、どう動くか」「どんなデータを、どんな形で持つか」「どこで、どんな構成で動かすか」を決める。

### 1.2 基本設計書の構成

基本設計書は、本書と次の詳細文書でできている。

| 文書 | 文書番号 | 内容 | 技術との関係 |
| --- | --- | --- | --- |
| 基本設計書（本書） | RC-BD | 全体の概要、表記のルール、これから行う設計、設計中に見つかった要件の不足と対応 | |
| [画面設計書](screen-design.md) | RC-BD-SCR | 共通仕様（色・文字・ボタン・メッセージ・共通の部品）、画面ごとのレイアウト・表示項目・操作 | 技術に依存しない |
| [データ設計書](data-design.md) | RC-BD-DATA | 方針、エンティティ一覧、ER 図、テーブル定義、データのルール、CRUD 表、データ量の見積もり | PostgreSQL の型で書く（要件定義書 P-1） |
| [インフラ設計書](infra-design.md) | RC-BD-INFRA | AWS の構成図、ネットワーク、WebSocket の通り道、S3 への直接のアップロード、通信の許可、開発環境との対応、費用の目安 | AWS（CloudFront・ALB・ECS Fargate・RDS・S3）を前提とする（要件定義書 P-4） |

機能ごとの処理・API（案）・リアルタイムの通知・エラーは[機能定義書](../functions/function-definition.md)で定める。使う言語・フレームワーク・サービスは[技術スタック定義書](../tech-stack.md)で定める。文書の一覧は [docs/README.md](../README.md) にある。

### 1.3 表記のルール

本書と詳細文書に共通のルールである。

- 「A-1」「MS-3」などの ID は機能定義書の要件 ID を、「FN-01」などは要件定義書 8 章の機能 ID を、「G-1」などは画面一覧の画面 ID を、「M-1」などは機能定義書 5 章のメッセージを表す（どの文書で定めているかは [docs/README.md](../README.md) の ID の一覧を参照）
- 図は Mermaid 記法かテキストで書く。VS Code で Mermaid を図として見るには、拡張機能「Markdown Preview Mermaid Support」を入れてプレビューを開く。GitHub ではそのまま図として表示される

---

## 2. これから行う設計

次の内容は、開発を始めるときに決め、本書か詳細文書に足す。BookLog で決めたやり方を基本にする。

### 2.1 API の詳細設計

API の一覧（URL・メソッド・入力・出力・主なエラー）、エラーの形、ページング、リアルタイムの通知の形は、機能定義書（共通の決まりは 3 章・4 章、機能ごとは各文書の 6 章）で決めた。開発を始めるときに、次の内容を足す。

| 項目 | 内容 |
| --- | --- |
| 入力・出力の項目の一覧 | 手で表を書かず、API のコード（Controller と record）から OpenAPI の形式で自動で作る（springdoc-openapi）。docs/api/openapi.yaml に書き出してコミットし、画面の型もそこから作る（openapi-typescript）。テストで、コミットした仕様書とコードがずれていないかを確かめる。BookLog と同じやり方 |
| リアルタイムの通知の型 | OpenAPI では書けないため、機能定義書 4.3 の表を正とし、サーバー（record。realtime パッケージの RealtimeEvent）と画面（TypeScript の型。src/realtime/events.ts）に同じ形を書く。サーバーのテスト（WebSocketApiTests）が、本物の WebSocket で受け取った通知の JSON を docs/api/realtime-events.json に書き出し（コミットしたものと違えば書き直して失敗する。OpenAPI と同じ）、画面のテストがその JSON を画面の読み取り処理（parseEvent）で読めることを確かめる |
| 処理の分け方 | Controller・Service・Repository の分け方と、1 つのトランザクションにまとめる範囲（ワークスペースの作成と general、メッセージの送信と添付・メンション、キック・退出など） |
| 見られるかの確かめ | 「その人がその会話を見られるか」を求める処理を 1 つの部品にまとめ、API・WebSocket の購読・検索・メンションの一覧・未読の件数のすべてで使う（機能定義書 FN-13 の 5 章の 3） |
| 通知を送る部品 | コミットの後に通知を送る部品（トランザクションの後に動く仕組みを使う）と、購読の取り消し（機能定義書 4.5） |
| 画面の部品の分け方 | 画面（G）ごとの React の部品と、共通の部品（ヘッダー・サイドバー・メッセージ・入力欄・アバター・絵文字の一覧） |
| 画面の状態の持ち方 | WebSocket で届いた通知を、サイドバー・メッセージの一覧・スレッドに反映する仕組み（同じメッセージを二重に出さない。機能定義書 FN-07 の 5 章の 7） |

### 2.2 運用設計

| 項目 | 内容 |
| --- | --- |
| 環境の作り方 | 開発環境（Docker Compose）は README の「起動方法」に、AWS（Terraform）は 2.2.1 に書いた |
| 表の変更の管理 | backend/src/main/resources/db/migration に V{番号}__{内容}.sql を足す。main に入れたファイルは変えず、変更は新しいファイルで行う。API の起動時に Flyway が流し、JPA は表の定義を確かめるだけにする（ddl-auto=validate） |
| 公開の手順 | API のイメージ（ECR）と画面（S3）の反映、止め方・起動し直し方、検収の後の消し方（要件定義書 P-5）。2.2.1 に書いた |
| データベースのバックアップと復旧 | RDS の自動バックアップからの戻し方（N-10）。2.2.2 に書いた |
| 不適切なメッセージ・添付の削除 | オーナーが削除しない場合に、作成者がデータベースと S3 から消す手順（R-2）。2.2.3 に書いた |
| JWT の秘密の値の変え方 | 漏れた・漏れた疑いがあるときに、Parameter Store の値を変え、リフレッシュトークンを全部無効にして全員をログアウトさせる手順。2.2.4 に書いた |
| 定期の処理 | 期限切れのリフレッシュトークンの削除（RefreshTokenCleanup）、期限切れから 30 日たった招待リンクの削除（InviteCleanup）、送らなかった添付の削除（AttachmentCleanup）、S3 から消せなかったファイルの消し直し（StorageDeleter）を、API の中の @Scheduled で毎日 4:30（日本時間）に動かす。タスクは 1 つなので重ならない（インフラ設計書 方針 4）。止めている間は動かず、次に動いている 4:30 にまとめて行う |
| 費用の確認 | 月 1 回の確認手順と AWS Budgets の設定（R-1）。2.2.1 に書いた |
| 障害時の対応 | 障害に気づく方法は CloudWatch のアラームのメール（インフラ設計書 3.3）。調べ方は 2.2.1 の「困ったとき」。WebSocket のつないだ・切れたは API のログ（WebSocketSessions）で数える |

#### 2.2.1 公開環境の手順

構成は[インフラ設計書](infra-design.md)のとおり。スクリプトはリポジトリのフォルダで Git Bash から実行する。どれも先に terraform plan を出し、「この内容で反映しますか？」に y と答えたときだけ反映する（`-y` を付けると確かめずに反映する）。

| スクリプト | すること | かかる時間 |
| --- | --- | --- |
| `bash deploy/deploy.sh` | 今のコミットを反映する。jar を作り、API のイメージ（arm64）をコミット ID のタグで ECR に push し、`terraform apply -var running=true` で新しいタスクに入れ替える。画面をビルドして S3 に置き（assets/ は 1 年、ほかは no-cache）、CloudFront のキャッシュを消して、公開 URL の /actuator/health が UP になるのを待つ。コミットしていない変更があるとき、RDS が動いていないときは止まる | 10〜15 分 |
| `bash deploy/start.sh` | RDS を起動して待ち、`running=true` で ECS のサービスと ALB を作り直す。イメージと画面は前に反映したものを使う | 10〜20 分 |
| `bash deploy/stop.sh` | `running=false` で CloudFront を止めている間のページにし、ECS のサービスと ALB を消して、RDS を止める。データと URL はそのまま | 5〜10 分 |

**初めて作るとき**

1. 手元に AWS CLI（~/.aws の鍵）・Terraform・Docker Desktop を用意する（技術スタック定義書 3.4）
2. deploy/terraform/terraform.tfvars に `alert_email = "通知を受け取るメールアドレス"` を書く（リポジトリには入れない）
3. deploy/terraform で `terraform init` → `terraform plan` で中身を確かめ → `terraform apply`（running は既定の false。CloudFront・RDS などを作る。15〜20 分）
4. 届いたメール（AWS Notification）の「Confirm subscription」を押す
5. `bash deploy/deploy.sh` で最初のイメージと画面を反映する（ECR にイメージがないうちは running=true にできないため、start.sh ではなく deploy.sh を使う）

**すべて消すとき**

元に戻せない。公開の URL も変わる（作り直すと別の URL になる）。

1. deploy/terraform で `terraform apply -var rds_deletion_protection=false` で RDS の削除保護を外す（RDS が止まっていると、変更の後の待ち合わせで失敗と出るが、削除保護は外れる。`aws rds describe-db-instances` の DeletionProtection で確かめる）
2. S3 の画面と添付のバケット（`aws s3 rm s3://<バケット> --recursive`）と ECR（`aws ecr batch-delete-image`）を空にする。中身があると Terraform は消せない
3. `terraform plan -destroy -var rds_deletion_protection=false` で中身を確かめてから、`terraform destroy -var rds_deletion_protection=false`（CloudFront の削除に 20 分ほどかかる）
4. 消す前に取った最後のスナップショット（rc-db-final）が要らなければ、`aws rds delete-db-snapshot --db-snapshot-identifier rc-db-final` で消す

**反映のきまり**

- 入れ替えでは、古いタスクを止めてから新しいタスクを起動する（インフラ設計書 方針 10）。その間（1〜2 分）は API が 502・503 になり、WebSocket も切れる。画面はつなぎ直し、取り直す（要件定義書 R-7）。利用者が少ない時間に反映する
- 新しいタスクが起動しなければ、ECS が前のタスク定義に戻す（デプロイのサーキットブレーカー）。戻すまでの数分も止まる。このとき terraform apply は失敗で終わる
- イメージのタグは上書きできず、Terraform は ECR に最後に push したイメージを使う。前のコミットに戻すときは、`git revert` で新しいコミットを作ってから反映する
- 画面の古い assets/ は消さない（反映の前から開いている人が、古い画面のファイルを読めるように）

**困ったとき**

| 症状 | 調べるところ・対処 |
| --- | --- |
| deploy.sh・start.sh の apply がタスクの起動で止まる・失敗する | CloudWatch Logs の /rc/app で API のログを見る（起動の失敗・DB に接続できないなど）。ECS のコンソールのサービスの「イベント」で、イメージが取れない・ヘルスチェックに通らない・Parameter Store の値を読めないなどを見る |
| start.sh の plan が ECR のイメージを読めずに失敗する | ECR にイメージがない（初めてのとき）。deploy.sh で反映する |
| 公開 URL が「止めています」のページのまま | CloudFront の反映（5〜10 分）を待つ。続くなら `terraform output` と CloudFront のコンソールで、/api/* のビヘイビアがあるかを見る |
| 画面に「つながっていません」が出続ける | ブラウザの開発者ツールで /ws の応答を見る。403 なら Origin が WEB_ORIGIN（CloudFront の URL）と違う。ECS のタスク定義の環境変数を見る |
| 添付の送信が失敗する（ブラウザのコンソールに CORS のエラー） | 添付のバケットの CORS（`aws s3api get-bucket-cors --bucket <files_bucket>`）の送り元が、公開 URL と同じかを見る |
| Git Bash で `aws logs tail /rc/app` などが何も出さない・名前が違うと言われる | Git Bash が /rc/... を Windows のパスに書き換えている。`MSYS_NO_PATHCONV=1` を前に付ける |
| RDS が勝手に起動している | 止めてから 7 日たつと AWS が起動する。もう一度 stop.sh を実行する |
| deploy.sh の `npm ci` が EPERM（operation not permitted）で止まる | 開発用の Vite（5173）などが frontend/node_modules のファイルを使っている。止めてから deploy.sh をもう一度実行する（イメージの push と apply は済んでいれば飛ばされる） |
| 反映の直後に /api/* が 502 になる | CloudFront の設定の反映中か、タスクの入れ替え中。数分待つ |
| apply が `Unrecognized remote plugin message` で途中で止まる | Windows で、.terraform の中の random プロバイダーの exe が消えていることがある（Raise timeline で起きた）。deploy/terraform で `terraform init` をして入れ直し、同じスクリプトをもう一度実行する（途中まで済んだ分は state に残っている） |

**費用の確認**

月 1 回、請求のコンソールで費用とクレジットの残りを確かめる。AWS Budgets（rc-budget）は、実際の費用が予算の 80% を超えたときと、月末の予測が予算を超えそうなときにメールを送る（R-1）。動画が多いと S3 からの転送の費用が増えるので、S3 の費用も見る（インフラ設計書 7 章）。無料プランの間は、クレジットの残りと期限にも気を付ける。

#### 2.2.2 データベースの復旧（N-10、R-9）

RDS の自動バックアップから、別の RDS に戻して入れ替える。戻せるのは自動バックアップを残している間だけである（無料プランの間は 1 日。インフラ設計書 3.2）。この手順はまだ実際に試していない。

1. `terraform -chdir=deploy/terraform apply -var running=false` で API を止める（書き込みを止めるため）
2. 今の RDS の名前を変える：`aws rds modify-db-instance --db-instance-identifier rc-db --new-db-instance-identifier rc-db-old --apply-immediately`
3. 戻したい時刻（UTC）で、元の名前の RDS を作る：`aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier rc-db-old --target-db-instance-identifier rc-db --restore-time <時刻> --db-instance-class db.t4g.micro --db-subnet-group-name rc-db --vpc-security-group-ids <SG-3 の ID> --no-publicly-accessible`。`aws rds wait db-instance-available --db-instance-identifier rc-db` で待つ
4. `bash deploy/start.sh` を実行する。plan で RDS が作り直し（replace）にならないことを確かめてから y と答える
5. 公開 URL で動きを確かめたら、rc-db-old の削除保護を外して消す

S3 の添付はバージョンを残していないので、戻した時刻より後に消した添付は戻らない。その添付は表示できない。

#### 2.2.3 不適切なメッセージ・添付の削除（R-2）

まずワークスペースのオーナーに、メッセージの削除（FN-07 MS-10）を頼む。オーナーが対応しないときは、見つけた日から 3 日以内に（要件定義書 15.2）、作成者がデータベースと S3 から消す。RDS は VPC の中からしかつなげないので、psql の入った PostgreSQL のイメージを API と同じセキュリティグループの Fargate のタスクとして 1 回だけ動かし（Raise timeline と同じ方法。開発計画書 2-8 で公開先の性能テストのデータを入れるときに作る）、結果は CloudWatch Logs で読む。

1. メッセージの ID を、知らせてもらった本文・送った人・日時から探す：`SELECT m.id, u.display_name, m.created_at, left(m.body, 50) FROM messages m JOIN users u ON u.id = m.user_id WHERE m.body LIKE '%<本文の一部>%' ORDER BY m.id DESC LIMIT 20;`
2. 添付のファイルを消す一覧に入れる：`INSERT INTO storage_deletions (storage_key) SELECT k FROM attachments, LATERAL (VALUES (storage_key), (thumbnail_key)) v(k) WHERE message_id = <ID> AND k IS NOT NULL ON CONFLICT DO NOTHING;`。翌日 4:30 の StorageDeleter が S3 から消す（急ぐときは `aws s3 rm s3://<files_bucket>/<storage_key>` で消す。バケットの名前は `terraform output files_bucket`）
3. メッセージを消す：`DELETE FROM messages WHERE id = <ID>;`（添付・リアクション・メンションの行と、スレッドの返信も一緒に消える）。返信を残すときは、代わりに `UPDATE messages SET body = '', deleted_at = now() WHERE id = <ID>;` と `DELETE FROM attachments WHERE message_id = <ID>;` を行う（アプリで返信のある親を消したときと同じ形。データ設計書 方針 3）
4. 開いている画面には通知が届かないので、利用者が読み直すまでは前の表示が残る

#### 2.2.4 JWT の秘密の値の変え方

漏れた・漏れた疑いがあるときに行う。全員がログアウトされる。

1. `terraform -chdir=deploy/terraform apply -replace=random_password.jwt -var running=true` で新しい値を Parameter Store に置く（値は Terraform が作るので、手で置くと次の apply で戻る）
2. `aws ecs update-service --cluster rc-cluster --service rc-app --force-new-deployment` でタスクを入れ替える。タスクは起動するときにしか値を読まない。ここで全員のアクセストークンが使えなくなり、WebSocket も切れる
3. 2.2.3 と同じ方法で、リフレッシュトークンを全部無効にする：`UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL;`

### 2.3 ログ

BookLog と同じく、公開先ではログを JSON（ECS 形式）で出し、CloudWatch Logs Insights で探す。開発を始めるときに、次の内容を足す。

| 項目 | 内容 |
| --- | --- |
| リクエストのログ | 1 つのリクエストに 1 行。メソッド・URL・ステータス・かかった時間・ログインした人の ID |
| WebSocket のログ | つないだ・切れた（理由つき）・購読を断った・購読を取り消したときに 1 行。項目は event.action（websocket-connected・websocket-closed・websocket-subscribe-denied・websocket-subscription-revoked）、websocket.user_id（つないだ人の ID）、websocket.session_id、conversation.id、切れたときの websocket.close_code・websocket.close_reason。人の ID を user.id にしないのは、API のリクエストの中で出すログ（購読の取り消し）では、操作した人の ID が user.id に付くため |
| 出さないもの | パスワード、JWT・リフレッシュトークン、Cookie、招待の文字列、署名付き URL、メッセージの本文・ファイル名・ステータスの文 |

### 2.4 性能テスト

BookLog と同じく、API は k6、画面は Playwright で測り、要件定義書 11.1 の条件のデータを入れて P95 を見る（開発計画書 2-2）。動かし方は README「性能テスト」。

| 項目 | 内容 |
| --- | --- |
| データの作り方 | perf/seed.sql。ユーザー 1,000 人・ワークスペース 100・メッセージ 50 万件（うち返信 10 万件）・リアクション 20 万件・添付 2 万件・メンション約 5 万件を、開発用とは別の DB（raisechat_perf）に入れる。測るワークスペースはメンバー 200 人・チャンネル 50・メッセージ約 10 万件。本文は 40 個の日本語の言葉から 6 個を並べ、1,000 件に 1 件だけまれな言葉を入れる |
| API の測り方 | k6 で、1 人で各 API を 50 回ずつ呼ぶ基準の測定と、50 人（11.1 の同時にログインしている人）が考える時間を挟みながら 5 分使う測定。画面の目標（N-1 3 秒・N-2 1 秒・N-5 2 秒）は描画を含むので、API はそれぞれ 0.5〜2 秒を目安にする |
| リアルタイムの通知の測り方 | k6 で 50 人分の WebSocket（STOMP）の接続を作り、会話と本人あての通知を購読させる。別の 1 人が 2 秒おきに 60 回送り、送り始めてから全員に届くまでを測る。偶数番目は購読している会話に送り（N-3 の message.created）、奇数番目はほかの会話に送る（N-4 の conversation.updated。未読の件数） |
| 画面の測り方 | Playwright（Edge）で、パソコン（1280px）とスマートフォン（375px・CPU を 4 倍遅く）の幅で、下り 10Mbps・上り 30Mbps・遅延 20ms にして 20 回ずつ測る。2 人の画面にまたがる時間（N-3・N-4・N-6・N-7）は、送る人が押した時刻と、相手の画面に出た時刻（MutationObserver）の差で測る。50 人の負荷をかけながらも測る |
| 検索の測り方 | 3 文字以上のまれな言葉、よくある 2 文字の言葉、1 文字の言葉、見つからない 2 文字の言葉（全部の行を読む、いちばん遅い場合）、2 つの言葉を分けて測る（N-5） |
| 添付の測り方 | 画像 4 枚（10MB 弱ずつ、合計 40MB）・動画 1 本（100MB 弱、ffmpeg で作る）を、画面で選んでから相手の画面に縮小した画像・再生ボタンが出るまで（N-6・N-7）。再生ボタンを押してから再生が始まるまでも測る。大きなファイルを送るので、GitHub Actions のランナーの中（MinIO）と公開先だけで測る |
| 合否を決める環境 | 公開先（AWS。開発計画書 2-8）。手元・GitHub Actions のランナーの値は参考 |

手元（Windows 11・Docker Desktop の PostgreSQL・jar）で測った結果（2026-11-16。参考）：

| 要件 | 項目 | 目標（P95） | パソコン | スマートフォン | パソコン（50 人の負荷） | スマートフォン（50 人の負荷） |
| --- | --- | --- | --- | --- | --- | --- |
| N-1 | ワークスペースを選ぶ → 最新 50 件 | 3 秒 | 864ms | 1,421ms | 970ms | 1,619ms |
| N-2 | 会話を切り替える → 最新 50 件 | 1 秒 | 307ms | 486ms | 303ms | 1,256ms（不合格） |
| N-3 | 送る → 相手の画面に出る | 1 秒 | 83ms | 243ms | 106ms | 763ms |
| N-4 | 送る → 相手のサイドバーの件数 | 1 秒 | 69ms | 225ms | 77ms | 1,111ms（不合格） |
| N-5 | 検索 → 最初の 20 件（いちばん遅い「見つからない 2 文字の言葉」） | 2 秒 | 777ms | 579ms | 454ms | 905ms |

| 要件 | 項目（k6） | 目標（P95） | 結果 |
| --- | --- | --- | --- |
| N-3 | 送ってから、50 人に届くまで | 1 秒 | 50ms（1,500 件すべて届いた） |
| N-4 | 送ってから、50 人に未読の件数が届くまで | 1 秒 | 74ms（1,500 件すべて届いた） |
| N-1・N-2 | 最新 50 件のメッセージ（API。50 人の同時アクセス） | 0.5 秒 | 386ms |
| N-5 | 検索（API。見つからない 2 文字の言葉。50 人の同時アクセス） | 2 秒 | 445ms |

N-6・N-7 は、手元でも CI と同じ形（jar と MinIO）にして確かめた（N-6 を 4 回・N-7 を 1 回）：画像 4 枚 P95 13.8 秒（目標 15 秒）、動画 1 本 28.9 秒（目標 40 秒）、再生の開始は待たずに始まった。50 人の負荷をかけたときのスマートフォンの N-2・N-4 だけが目標を超えた。負荷のないときは 486ms・225ms で、同じ負荷でもパソコンは 303ms・77ms のため、1 台のパソコンで k6（50 人）・PostgreSQL・API・ブラウザを同時に動かし、さらにスマートフォンの CPU を 4 倍遅くしたことによる、ブラウザの側の遅れとみられる。公開先（開発計画書 2-8）では、k6 と画面を測るパソコンと API が別になるので、そこで改めて確かめる。最新 50 件のメッセージの API は、画像の添付が 200 枚ある general だけが遅い（署名付き URL を 400 個作る。ほかの会話は 10ms ほど）。目標の内には収まっているので、いまは直さない

GitHub Actions のランナー（2 vCPU）でも全部を流した（参考）。負荷のないときはスマートフォンの N-4 だけが目標を超え（1.2 秒）、50 人の負荷のときはスマートフォンの N-2〜N-4、パソコンの N-3、見つからない 2 文字の言葉の検索（画面 2.5 秒・API 2.6 秒）が目標を超えた。2 つの CPU で k6・PostgreSQL・API・ブラウザを同時に動かしているためとみて、公開先（開発計画書 2-8）で合否を決める。リアルタイムの通知は、ランナーでも 1,500 件すべて届いた

性能テストで見つかったこと：同じ検索を 5 回より多く続けると、1〜2 文字の言葉の検索が約 5 秒になった（PostgreSQL の汎用の計画。データ設計書 8.3）。検索の取引の中だけ plan_cache_mode = force_custom_plan にして直した。直した後は、いちばん遅い「見つからない 2 文字の言葉」でも N-5 の 2 秒に十分収まるので、検索の最小の文字数は設けない（開発計画書 2-2 で決めることにしていた）。

---

## 3. 設計中に見つかった要件の不足と対応

設計中に見つかった要件の不足・あいまいな点（Q-1〜）と、その対応を書く。要件定義書を変えなかったものも、どこで決めたかを残すためにここに書く。

| No | 見つかったこと | 対応 |
| --- | --- | --- |
| Q-1 | 画面一覧では、スレッドのパネルは G-5 の一部として URL を決めていなかった。読み込み直してもパネルを開いたままにするには、URL に入れる必要がある | 要件定義書（画面一覧）は変えない。URL（?thread={親メッセージの ID}）は機能定義書 FN-08 TH-6 で決めてあり、画面設計書 7.2 にも書いた |
| Q-2 | 要件定義書 N-12 は「公開時の通信はすべて HTTPS」としていたが、CloudFront から ALB までは HTTP になる（独自ドメインがなく ALB に証明書を付けられない。BookLog・Raise timeline と同じ構成） | N-12 を「利用者のブラウザとの通信はすべて HTTPS」に直し、CloudFront → ALB を HTTP とすることと理由を書いた（要件定義書 0.6）。この区間は AWS の CloudFront から ALB への通信で、ALB は CloudFront からだけ受け付け、秘密のヘッダーでも確かめる（インフラ設計書 方針 5・6）。公開は検収のときだけで、学習用であるため受け入れる |
