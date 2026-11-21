#!/bin/bash
# 今のコミットの API と画面を公開環境に反映する（インフラ設計書 5.2、基本設計書 2.2）
# リポジトリのフォルダで実行する（Windows では Git Bash。Docker Desktop を起動しておく）：bash deploy/deploy.sh
# ECS と ALB だけが止まっているとき（RDS は起動済み）に実行すると、そのまま起動もする。RDS が止まっていれば止まるので、先に bash deploy/start.sh
# --if-running を付けると（CD。.github/workflows/cd.yml）、動いているときだけ入れ替える。止めているときは、イメージ（ECR）と
# 画面（S3）を置くだけにして起動はしない（次の start.sh で使われる）。公開環境がないときは何もせずに終わる（インフラ設計書 5.3）
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=deploy/lib.sh
source deploy/lib.sh

if [[ -n "$(git status --porcelain)" ]]; then
  echo "コミットしていない変更があります。コミットしてから反映してください" >&2
  exit 1
fi

# 入れ替えるか。--if-running では、ECS のサービスがあるか（running = true で作ったか）で決める。
# RDS は止めてから 7 日で AWS が自動で起動するので、RDS の状態では決めない（起動すると費用がかかる）
replace=true
if [[ "$if_running" == true ]]; then
  if ! tf_output db_instance_id >/dev/null 2>&1; then
    report "公開環境がないので、反映しませんでした（基本設計書 2.2.1 の「初めて作るとき」で作ると、次のマージから反映されます）"
    exit 0
  fi
  if ! tf_output service_name >/dev/null 2>&1; then
    replace=false
  fi
fi
if [[ "$replace" == true ]]; then
  status=$(db_status)
  if [[ "$status" != available ]]; then
    echo "RDS が $status です。先に bash deploy/start.sh で起動してください" >&2
    exit 1
  fi
fi

tag=$(git rev-parse --short=12 HEAD)
repo=$(tf_output ecr_repository_url)
repo_name=${repo#*/}

echo "== API の jar を作る"
(cd backend && ./mvnw -B -q package -DskipTests)

echo "== API のイメージ（arm64）を作って ECR に push する（タグ $tag）"
if aws ecr describe-images --repository-name "$repo_name" --image-ids "imageTag=$tag" >/dev/null 2>&1; then
  echo "このコミットのイメージはもうあります"
else
  aws ecr get-login-password | docker login --username AWS --password-stdin "${repo%%/*}"
  # --provenance=false：ECR にタグのない付属のファイルを作らない（10 個まで残す数に入ってしまう）
  docker buildx build --platform linux/arm64 --provenance=false -t "$repo:$tag" --push backend
fi

# Terraform は ECR に最後に push したイメージを使う（ecr.tf）。タグは上書きできないので、古いコミットには戻せない。
# 中身が前と同じなら、ECR は同じイメージにタグを足すだけなので、タグではなくダイジェストで比べる
digest=$(aws ecr describe-images --repository-name "$repo_name" --image-ids "imageTag=$tag" \
  --query "imageDetails[0].imageDigest" --output text)
latest=$(aws ecr describe-images --repository-name "$repo_name" \
  --query "sort_by(imageDetails, &imagePushedAt)[-1].imageDigest" --output text)
if [[ "$latest" != "$digest" ]]; then
  echo "ECR の最新のイメージがこのコミット（$tag）のものではありません。戻すときは git revert して新しいコミットで反映してください" >&2
  exit 1
fi

if [[ "$replace" == true ]]; then
  tf_apply true
fi

echo "== 画面をビルドして S3 に置く"
(cd frontend && npm ci && npm run build)
web=s3://$(tf_output web_bucket)
# ファイル名にハッシュが付くので 1 年キャッシュする。前の画面を開いている人のため、古いファイルは消さない
aws s3 sync frontend/dist/assets "$web/assets" --cache-control "public, max-age=31536000, immutable"
# index.html とそれ以外のファイル（アイコンなど）は、反映したらすぐ読ませる
aws s3 sync frontend/dist "$web" --exclude "assets/*" --cache-control "no-cache"

if [[ "$replace" != true ]]; then
  report "公開環境を止めているので、イメージ（タグ $tag）と画面を置きました。次に起動したときに使われます"
  exit 0
fi

echo "== CloudFront のキャッシュを消す"
distribution=$(tf_output distribution_id)
invalidation=$(aws cloudfront create-invalidation --distribution-id "$distribution" --paths "/*" \
  --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed --distribution-id "$distribution" --id "$invalidation"

wait_healthy
report "コミット $tag を公開環境に反映しました：$(tf_output url)"
