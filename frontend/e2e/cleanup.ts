import { execFileSync } from 'node:child_process'

// テストで作ったものを開発用 DB から消す。テストのユーザー（ID が「e2e_」で始まる）が作ったワークスペースを消すと、
// 会話・メッセージ・添付・リアクション・メンション・招待リンクは ON DELETE CASCADE で一緒に消える。
// そのあとでリフレッシュトークンとユーザーを消す。
// 前の実行が途中で止まって残ったものも消せるよう、始める前（globalSetup）と終わった後（globalTeardown）に呼ぶ。
//
// S3 のファイル（添付・アバター）は DB を消しても残る。CI の MinIO は使い捨てなのでそのままでよいが、手元では
// S3 の開発用バケットに置くので、DB を消す前に、テストのワークスペースの workspaces/{ID}/ とテストのユーザーの
// アバターを aws コマンドで消す（環境変数 S3_ENDPOINT があるときは MinIO なので消さない）

const root = new URL('../..', import.meta.url)
// LIKE だと「_」が 1 文字の記号になるので、先頭の 4 文字で比べる
const E2E_USERS = "SELECT id FROM users WHERE left(username, 4) = 'e2e_'"

function psql(...commands: string[]): string {
  return execFileSync('docker', [
    'compose', 'exec', '-T', 'db',
    'psql', '-U', 'raisechat', '-d', 'raisechat', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
    ...commands.flatMap((c) => ['-c', c]),
  ], { cwd: root, encoding: 'utf8' })
}

const lines = (sql: string) => psql(sql).split('\n').map((l) => l.trim()).filter(Boolean)

const aws = (...args: string[]) => execFileSync('aws', ['s3', ...args, '--only-show-errors'], { stdio: 'inherit' })

function removeFromS3(): void {
  const bucket = process.env.S3_BUCKET ?? 'rc-files-dev-467112307516'
  const workspaces = lines(`SELECT id FROM workspaces WHERE owner_id IN (${E2E_USERS})`)
  const avatars = lines(`SELECT avatar_key FROM users WHERE id IN (${E2E_USERS}) AND avatar_key IS NOT NULL`)
  for (const id of workspaces) aws('rm', `s3://${bucket}/workspaces/${id}/`, '--recursive')
  for (const key of avatars) aws('rm', `s3://${bucket}/${key}`)
}

export default function cleanup(): void {
  if (!process.env.S3_ENDPOINT) removeFromS3()
  psql(
    `DELETE FROM workspaces WHERE owner_id IN (${E2E_USERS})`,
    `DELETE FROM refresh_tokens WHERE user_id IN (${E2E_USERS})`,
    `DELETE FROM users WHERE id IN (${E2E_USERS})`,
  )
}
