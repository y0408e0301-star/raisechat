# 開発ルール

このリポジトリでは、すべての変更を **Issue → ブランチ → Pull Request → main** の順で取り込む。
文書の修正 1 行でも例外にしない。

## 流れ

1. **Issue を立てる**
   - 何をするか・なぜするか・完了条件を書く（テンプレートあり）
   - ラベルを 1 つ付ける：`enhancement`（機能）、`bug`（不具合）、`documentation`（文書）、`chore`（設定・雑務）
   - 同じ内容の Issue があればそれを使う
2. **main を最新にしてからブランチを切る**

   ```
   git switch main
   git pull
   git switch -c <種類>/<Issue 番号>-<短い説明>
   ```

3. **ブランチでコミットする**
   - 1 コミット 1 まとまり。メッセージは「何をしたか」を日本語で書く
4. **push して Pull Request を作る**

   ```
   git push -u origin <ブランチ名>
   gh pr create
   ```

   - 本文に `Closes #<Issue 番号>` を書く（マージすると Issue が自動で閉じる）
5. **自動レビューを確かめる**
   - PR を開いたとき・push したときに、Claude Code が差分をレビューして日本語でコメントする（[.github/workflows/claude-code-review.yml](.github/workflows/claude-code-review.yml)）
   - 指摘を直すときは同じブランチに push する。直さない指摘は理由を PR にコメントする
6. **squash マージする**

   ```
   gh pr merge --squash --delete-branch
   ```

   - マージ後、ブランチは GitHub 上で自動削除される。手元は `git switch main` → `git pull` で最新にする

## ブランチ名

`<種類>/<Issue 番号>-<短い説明>`（英小文字・数字・ハイフン）

| 種類 | 使うとき | 例 |
| --- | --- | --- |
| `feat` | 機能の追加・変更 | `feat/4-message-api` |
| `fix` | 不具合の修正 | `fix/15-unread-count` |
| `docs` | 文書だけの変更 | `docs/2-requirements` |
| `refactor` | 動きを変えない整理 | `refactor/20-split-service` |
| `test` | テストだけの変更 | `test/21-message-api` |
| `chore` | 設定・依存関係・雑務 | `chore/1-dev-workflow` |

## 禁止事項

- main への直接コミット・直接 push
- Issue のない作業、Issue 番号のないブランチ
- force push（`git push --force` / `-f`）
- フックを飛ばす操作（`--no-verify`、`core.hooksPath` の変更）

## ルールを守らせる仕組み

| どこで | 何を止めるか |
| --- | --- |
| git フック（[.githooks/](.githooks/)） | main へのコミット、ルールに合わない名前のブランチでのコミット、main への push |
| GitHub | このリポジトリは private で GitHub Free のため、ブランチ保護は使えない（Pro にするか public にすると使える）。squash マージのみ・マージ後のブランチ自動削除は設定済み |
| Claude Code | [CLAUDE.md](CLAUDE.md) とユーザー設定のフックで、上の禁止事項を実行させない |
| GitHub Actions | PR ごとに Claude Code が差分をレビューし、このルール・要件定義書と食い違っていないかも見る（認証は secret `CLAUDE_CODE_OAUTH_TOKEN`） |

### 初回だけ必要な設定

git フックを有効にする。クローンしたら最初に 1 回実行する。

```
git config core.hooksPath .githooks
```
