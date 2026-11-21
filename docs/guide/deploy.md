# 公開環境

AWS に公開するときのスクリプトと注意。構成・費用は[インフラ設計書](../design/infra-design.md)、初めて作るとき・すべて消すときの手順は[基本設計書 2.2.1](../design/basic-design.md#221-公開環境の手順)にある。

[README に戻る](../../README.md)・[ガイドの一覧](README.md)

**反映は自動**：Pull Request を main にマージして CI が通ると、CD（[.github/workflows/cd.yml](../../.github/workflows/cd.yml)）が公開環境に反映します。動いていれば入れ替え、止めていればイメージと画面を置くだけ（次の起動で使われる）、なければ何もしません。結果は Actions の実行の画面に出ます（[インフラ設計書 5.3](../design/infra-design.md#53-公開の手順cd)）。

**起動・停止**：Actions の画面で「公開環境の起動・停止」を選び、Run workflow で start か stop を選びます（[.github/workflows/ops.yml](../../.github/workflows/ops.yml)）。手元のスクリプトでも同じことができます。

| コマンド（Git Bash） | すること |
| --- | --- |
| `bash deploy/deploy.sh` | 今のコミットの API（ECR）と画面（S3）を手元から反映する（CD の予備）。止めていれば起動もする |
| `bash deploy/start.sh` | RDS を起動し、ECS のサービスと ALB を作り直す |
| `bash deploy/stop.sh` | 「止めています」のページにして、ECS のサービスと ALB を消し、RDS を止める |

- いまは公開していません。受け入れ（開発計画書 2-8）の後に消し、CD を確かめるために作り直した環境も、確かめた後の 2026-11-22 に消しました（CD の土台は残しています）。もう一度公開するときは、基本設計書 2.2.1 の「初めて作るとき」の手順で作り直します（URL は変わります）。作った後は、マージで CD が反映します
- AWS のリソースはすべて Terraform（`deploy/terraform/`）で作ります。手作業で作るものはありません。CD の OIDC のロールと状態ファイルのバケットは `deploy/bootstrap/` で作り、公開環境を消しても残します
- Terraform の状態ファイルは S3（`rc-tfstate-{アカウント ID}`）にあり、手元と CD で同じものを使います
- 公開の URL は CloudFront を作ったときに決まり、止めたり起動したりしても変わりません（`terraform destroy` で消すと変わります）
- 反映でタスクを入れ替える間（1〜2 分）は使えず、WebSocket も切れます（画面がつなぎ直します）
- 常に動かすと月 14,600 円ほどかかり予算（月 10,000 円）を超えるため、使う時間だけ動かします。公開は検収のときだけ行い、終わったら環境を消します（要件定義書 P-5）
