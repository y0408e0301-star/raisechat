# 秘密の値（インフラ設計書 3.3、要件定義書 N-23）。Parameter Store に SecureString で置き、タスクの起動時に環境変数で渡す

# URL に入れても困らないよう、記号は使わない
resource "random_password" "db" {
  length  = 32
  special = false
}

# JWT の署名（HS256。32 バイト以上）。値を変えると、全員のアクセストークンが使えなくなる
resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "db_password" {
  name  = "/rc/db/password"
  type  = "SecureString"
  value = random_password.db.result
}

resource "aws_ssm_parameter" "jwt_secret" {
  name  = "/rc/jwt/secret"
  type  = "SecureString"
  value = random_password.jwt.result
}
