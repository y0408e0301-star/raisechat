output "url" {
  description = "公開 URL（CloudFront）。止めても変わらない"
  value       = local.web_origin
}

output "distribution_id" {
  description = "CloudFront の ID（deploy/deploy.sh が index.html のキャッシュを消すのに使う）"
  value       = aws_cloudfront_distribution.main.id
}

output "ecr_repository_url" {
  description = "API のイメージを push する先（deploy/deploy.sh が使う）"
  value       = aws_ecr_repository.app.repository_url
}

output "web_bucket" {
  description = "画面のファイルを置くバケット（deploy/deploy.sh が使う）"
  value       = aws_s3_bucket.web.bucket
}

output "files_bucket" {
  description = "添付・アバターのバケット"
  value       = aws_s3_bucket.files.bucket
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "service_name" {
  description = "ECS のサービス。running = false なら null"
  value       = var.running ? aws_ecs_service.app[0].name : null
}

output "db_instance_id" {
  description = "RDS の識別子（deploy/start.sh・stop.sh が使う）"
  value       = aws_db_instance.main.identifier
}
