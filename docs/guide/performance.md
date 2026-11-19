# 性能テスト

要件定義書 11.1 の性能（N-1〜N-7）の測り方。公開先で測った結果は[性能試験報告書](../test/performance-test-report.md)にある。

[README に戻る](../../README.md)・[ガイドの一覧](README.md)

要件定義書 11.1 の性能（N-1〜N-7）を、要件の量のデータ（ユーザー 1,000 人・ワークスペース 100・メッセージ 50 万件など。測るワークスペースはメンバー 200 人・チャンネル 50・メッセージ 10 万件）を入れて測ります。方針は[基本設計書 2.4](../design/basic-design.md#24-性能テスト)にあります。P95（小さい順に並べて 95% の位置の値）が目標以内なら合格です。Pull Request の CI では動かしません。

| コマンド（`frontend` で実行） | 内容 | かかる時間 |
| --- | --- | --- |
| `npm run perf -- seed` | 性能テスト用の DB `raisechat_perf` にデータを入れ、測るワークスペースの画像 200 枚を S3 に置く。何回流しても同じ形のデータになる | 約 4 分 |
| `npm run perf -- api` | k6 で、1 人で各 API を 50 回ずつ呼ぶ（N-1・N-2・N-5 の API、送信・既読・リアクションなど） | 約 1 分 |
| `npm run perf -- load` | k6 で、50 人が同時に使う | 約 6 分半 |
| `npm run perf -- realtime` | k6 で、50 人が WebSocket でつないで購読し、1 人が送ってから全員に届くまでを測る（N-3・N-4） | 約 3 分 |
| `npm run perf -- ui` | Playwright（Edge）で、パソコンとスマートフォンの幅で N-1〜N-5 を 20 回ずつ測る。回線は下り 10Mbps・上り 30Mbps | 約 20 分 |
| `npm run perf -- mixed` | k6 で 50 人の負荷をかけながら、画面で N-1〜N-5 を測る | 約 20 分 |
| `npm run perf -- all` | 上の 5 つを順にすべて動かし、結果を `perf/results/summary.md` にまとめる | 約 1 時間 |
| `npm run perf -- clean` | データと S3 の画像を消す | 数秒 |

手元で動かす手順：

1. Docker Desktop を起動し、リポジトリのフォルダで `docker compose up -d`
2. [テストとコードチェック](testing.md#画面も入れた-jar)の「画面も入れた jar」の 1・2 で jar を作る
3. 8080 の API サーバー（`mvnw spring-boot:run`）が動いていれば止め、リポジトリのフォルダで `java -Xmx1536m -jar backend\target\backend-0.0.1-SNAPSHOT.jar --spring.profiles.active=perf` を実行する（perf プロファイルは、開発用の DB ではなく `raisechat_perf` につなぎ、WebSocket の Origin を 8080 にする。ポートは 8080 のまま）
4. `frontend` で `npm run perf -- seed`（初回は DB を作って止まるので、3 の API を起動し直してから、もう一度実行する。表は API の起動のときに Flyway が作る）
5. `npm run perf -- all`（または `api`・`ui` など 1 つずつ）。終わったら `npm run perf -- clean`

- k6 は Docker のイメージ（`grafana/k6:2.2.0`）で動くので、入れる必要はありません。Playwright はパソコンの Edge を使います
- 画像 4 枚（40MB）の送信（N-6）と動画 1 本（100MB）の送信と再生（N-7）は、`PERF_UPLOAD=1` を付けたときだけ測ります。手元の S3 の開発用バケットは Vite（5173）の画面からの送信だけを受け付ける（CORS）ため、jar（8080）の画面からは送れません。GitHub Actions のランナーの中（MinIO）と公開先で測ります。動画は ffmpeg で作ります
- 測る回数は `PERF_RUNS`（既定 20）、測る先は `PERF_BASE_URL`（既定 `http://localhost:8080`）で変えられます
- 手元とランナーの数値は参考です。合否は公開先（AWS）で測った値で決めます（開発計画書 2-8）
- 公開先で測るとき：公開して（[公開環境](deploy.md)）、`frontend` で `PERF_DB=aws npm run perf -- seed`（PowerShell では `$env:PERF_DB='aws'; npm run perf -- seed`）。RDS には手元からつなげないので、psql の入った Fargate のタスクを 1 回動かして入れます（[frontend/perf/aws.ts](../../frontend/perf/aws.ts)。10 分以上かかることがあります）。測るワークスペースの画像は公開先の添付のバケットに置きます。そのあと Actions の「性能テスト」を、測る先に公開先の URL を入れて動かします。終わったら `PERF_DB=aws npm run perf -- clean`。公開先の DB は利用者と同じなので、seed・clean は実行する前に確かめます（`-y` で確かめない）。clean が消すのは、ユーザー ID が `perf_` と 4 桁の数字で表示名が「性能テスト」で始まるユーザーと、その人が作ったワークスペースです

GitHub Actions で動かす：Actions の画面で「性能テスト」を選び、「Run workflow」を押します（[.github/workflows/perf.yml](../../.github/workflows/perf.yml)）。測る先を空にすると、ランナーの中で DB・MinIO（S3 の代わり）・jar を起動して、データを入れてから測ります（N-6・N-7 も測ります）。結果は実行の画面に表で出て、成果物 `perf-results` にも残ります。
