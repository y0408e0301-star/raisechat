# 公開環境の CD（.github/workflows/cd.yml）の土台。公開環境（deploy/terraform）を destroy しても残すものだけを置く
# （インフラ設計書 5.3）。このフォルダの状態ファイルは手元に置く（このフォルダの状態には秘密の値は入らない）。初めに 1 回だけ、このフォルダで
# terraform init → terraform apply を実行する
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "ap-northeast-1"

  default_tags {
    tags = {
      Project = "raisechat"
    }
  }
}

variable "github_repository" {
  description = "反映してよいリポジトリ（owner/name）"
  type        = string
  default     = "y0408e0301-star/raisechat"
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
}

# 公開環境の Terraform の状態ファイルの置き場所（deploy/terraform/versions.tf の backend）。
# 公開環境の状態には DB のパスワードと JWT の秘密の値が入るので、パブリックアクセスを止め、暗号化した通信だけを許す。
# 読み書きできるのは、作成者と CD のロール（rc-github-deploy）だけ。消してしまった状態を戻せるよう、版を残す
# 採らない指摘（trivy）：アクセスログ（AWS-0089）は取らない（読み書きするのは作成者と CD のロールだけ）。
# KMS の顧客管理キー（AWS-0132）は月 1 ドルかかる。S3 の既定の暗号化（SSE-S3）で足りる
#trivy:ignore:AWS-0089
#trivy:ignore:AWS-0132
resource "aws_s3_bucket" "tfstate" {
  bucket = "rc-tfstate-${local.account_id}"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 古い版は 30 日で消す（状態ファイルは小さいが、反映のたびに版が増える）
resource "aws_s3_bucket_policy" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.tfstate.arn, "${aws_s3_bucket.tfstate.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.tfstate]
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# GitHub Actions が、鍵を持たずに短い時間だけ AWS に入るための仕組み（OIDC）
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# CD（cd.yml）と起動・停止のボタン（ops.yml）が使うロール。main のワークフローからだけ使える
# （Pull Request・フォーク・ほかのブランチからは使えない）
resource "aws_iam_role" "github_deploy" {
  name = "rc-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:ref:refs/heads/main"
        }
      }
    }]
  })
  max_session_duration = 7200
}

# 公開環境の Terraform は VPC・ECS・RDS・CloudFront・S3・SSM・予算などを作るので、IAM 以外はまとめて許す
resource "aws_iam_role_policy_attachment" "power_user" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

# 公開環境のロール（rc-task-execution・rc-app。deploy/terraform/iam.tf）に付ける権限の境界。どんなポリシーを付けても、
# （Resource は公開環境の名前 rc-files-*・/rc/*・rc-* に合わせている。名前を変えたら、ここも直す）
# ここに書いた範囲（イメージの取得・ログ・秘密の値の読み取り・添付のバケット）より強くはならない。
# CD のロールが rc- のロールを作って強い権限を付け、それを使う（権限の昇格）のを防ぐ
resource "aws_iam_policy" "role_boundary" {
  name = "rc-role-boundary"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = "arn:aws:ecr:*:${local.account_id}:repository/rc-*"
      },
      {
        Effect   = "Allow"
        Action   = "ssm:GetParameters"
        Resource = "arn:aws:ssm:*:${local.account_id}:parameter/rc/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::rc-files-*/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = "arn:aws:s3:::rc-files-*"
      },
    ]
  })
}

# IAM は、公開環境が作る rc- で始まるロールだけを作り・変え・ECS に渡せる。ロールを作る・権限を付けるのは、
# 上の境界を付けたロールにだけできる（境界を外すこと、ほかのポリシーを作り・変えることはできない）。読むのはすべて
# 採らない指摘（trivy）：IAM の読み取りを * にしている（AWS-0057）。Terraform が差分を確かめるのに要る
#trivy:ignore:AWS-0057
resource "aws_iam_role_policy" "github_deploy_iam" {
  name = "manage-rc-roles"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:PutRolePermissionsBoundary", "iam:PutRolePolicy", "iam:DeleteRolePolicy",
          "iam:AttachRolePolicy", "iam:DetachRolePolicy",
        ]
        Resource = "arn:aws:iam::${local.account_id}:role/rc-*"
        Condition = {
          StringEquals = { "iam:PermissionsBoundary" = aws_iam_policy.role_boundary.arn }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "iam:DeleteRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole", "iam:PassRole",
        ]
        Resource = "arn:aws:iam::${local.account_id}:role/rc-*"
      },
      {
        Effect   = "Deny"
        Action   = "iam:*"
        Resource = aws_iam_role.github_deploy.arn
      },
      {
        Effect   = "Allow"
        Action   = ["iam:Get*", "iam:List*"]
        Resource = "*"
      },
    ]
  })
}

output "tfstate_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}

output "role_boundary_arn" {
  value = aws_iam_policy.role_boundary.arn
}

output "deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}
