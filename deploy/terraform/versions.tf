terraform {
  required_version = ">= 1.10"

  # 状態ファイルは S3 に置き、手元と CD（.github/workflows/cd.yml）で同じものを使う。バケットは deploy/bootstrap が作る
  # （インフラ設計書 5.3）。use_lockfile で、同時に 2 か所から反映しないよう S3 の上でロックする。
  # backend には変数を使えないので、バケット名にアカウント ID を書く
  backend "s3" {
    bucket       = "rc-tfstate-467112307516"
    key          = "raisechat/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project = "raisechat"
    }
  }
}

data "aws_caller_identity" "current" {}
