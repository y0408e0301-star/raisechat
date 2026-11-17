# Fargate のタスクのロール（インフラ設計書 3.3）。アクセスキーは使わない

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# 実行ロール：ECS がタスクを起動するときに使う（イメージの取得・ログの送信・秘密の値の取得）
resource "aws_iam_role" "task_execution" {
  name               = "rc-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# SecureString は AWS 管理の鍵（aws/ssm）で暗号化しているので、kms:Decrypt は要らない
resource "aws_iam_role_policy" "task_execution_secrets" {
  name = "read-secrets"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ssm:GetParameters"
      Resource = [aws_ssm_parameter.db_password.arn, aws_ssm_parameter.jwt_secret.arn]
    }]
  })
}

# タスクロール：アプリ（AWS SDK）が使う。添付のバケットの workspaces/（添付）と avatars/（アバター）だけ。
# 署名付き URL もこのロールで署名するので、ブラウザの PUT・GET もこの範囲に限られる
resource "aws_iam_role" "task" {
  name               = "rc-app"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

locals {
  file_prefixes = ["workspaces/", "avatars/"]
}

resource "aws_iam_role_policy" "task_files" {
  name = "files"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = [for p in local.file_prefixes : "${aws_s3_bucket.files.arn}/${p}*"]
      },
      # ListBucket があると、まだ置かれていないファイルを読んだときに 403 ではなく 404 が返り、
      # complete で「アップロードされていない」（UPLOAD_NOT_FOUND_IN_STORAGE）を権限のエラーと見分けられる
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.files.arn
        Condition = {
          StringLike = { "s3:prefix" = [for p in local.file_prefixes : "${p}*"] }
        }
      },
    ]
  })
}
