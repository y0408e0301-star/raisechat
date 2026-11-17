# API と WebSocket を動かす ECS Fargate（インフラ設計書 3.2）。タスクは 1 つ（WebSocket の配信（simple broker）が
# タスクのメモリの中にあり、2 つにすると片方につないだ人にもう片方の通知が届かないため。方針 4）。
# running = false の間はサービスとタスク定義を消す（クラスターは費用がかからないので残す）

locals {
  container_name = "app"
}

#trivy:ignore:AWS-0034
resource "aws_ecs_cluster" "main" {
  name = "rc-cluster"

  # Container Insights は費用がかかるので使わない（ログは /rc/app で見る）
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_task_definition" "app" {
  count                    = local.running_count
  family                   = "rc-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  # 1 vCPU・2GB（技術スタック定義書 3.5）。ヒープはこの 75%（backend/Dockerfile）
  cpu                = 1024
  memory             = 2048
  execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn      = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name      = local.container_name
    image     = "${aws_ecr_repository.app.repository_url}@${data.aws_ecr_image.app[0].image_digest}"
    essential = true
    portMappings = [{
      containerPort = 8080
      protocol      = "tcp"
    }]
    # application.properties が読む環境変数
    environment = [
      { name = "DB_URL", value = "jdbc:postgresql://${aws_db_instance.main.address}:5432/${aws_db_instance.main.db_name}" },
      { name = "DB_USERNAME", value = aws_db_instance.main.username },
      { name = "COOKIE_SECURE", value = "true" },
      # WebSocket の Origin の確かめ（N-25）に使う。添付のバケットの CORS（s3.tf）も同じ URL だけを許す
      { name = "WEB_ORIGIN", value = local.web_origin },
      { name = "S3_BUCKET", value = aws_s3_bucket.files.bucket },
      { name = "AWS_REGION", value = var.region },
    ]
    secrets = [
      { name = "DB_PASSWORD", valueFrom = aws_ssm_parameter.db_password.arn },
      { name = "JWT_SECRET", valueFrom = aws_ssm_parameter.jwt_secret.arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "app"
      }
    }
  }])
}

resource "aws_ecs_service" "app" {
  count            = local.running_count
  name             = "rc-app"
  cluster          = aws_ecs_cluster.main.id
  task_definition  = aws_ecs_task_definition.app[0].arn
  desired_count    = 1
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  # 入れ替えでは古いタスクを止めてから新しいタスクを起動する（同時に 2 つ動かさない。方針 10）
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  # NAT ゲートウェイがないので、パブリック IP で ECR・Parameter Store・CloudWatch Logs に出る（受けるのは SG-2 で ALB からだけ）
  network_configuration {
    subnets          = [for s in aws_subnet.public : s.id]
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app[0].arn
    container_name   = local.container_name
    container_port   = 8080
  }

  # Spring Boot の起動（Flyway を含む）に時間がかかるので、その間はヘルスチェックの失敗で止めない
  health_check_grace_period_seconds = 180

  # 新しいタスクが起動しなければ、前のタスク定義に戻す
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # 新しいタスクが ALB のヘルスチェックに通るまで apply を待つ
  wait_for_steady_state = true

  depends_on = [aws_lb_listener_rule.from_cloudfront]
}
