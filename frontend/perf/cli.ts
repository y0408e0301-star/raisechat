import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { accountId, remotePsql } from './aws.ts'
import type { Result } from './measure.ts'
import { noisePng } from './png.ts'

// 性能テスト（開発計画書 2-2、基本設計書 2.4）をまとめて動かす。frontend で npm run perf -- <コマンド>。
// 先に DB（docker compose up -d）と、jar を perf プロファイルで起動しておく（README「性能テスト」）
const USAGE = `使い方：npm run perf -- <コマンド>
  seed     DB raisechat_perf にデータ（要件定義書 11.1 の量）を入れ、測るワークスペースの画像を S3 に置く（数分かかる）
  clean    データと S3 の画像を消す
  api      API を 1 人で測る（k6。N-1・N-2・N-5 の API、送信・既読・リアクション）
  load     API を 50 人の同時アクセスで測る（k6。約 6 分半）
  realtime 50 人が WebSocket でつないでいるときの通知の速さを測る（k6。N-3・N-4。約 3 分）
  ui       画面で測る（Playwright。N-1〜N-5。PERF_UPLOAD=1 なら N-6・N-7 も）
  mixed    k6 で 50 人の負荷をかけながら、画面で N-1〜N-5 を測る
  report   perf/results/ の結果を 1 つの表（summary.md）にまとめる
  all      api → load → realtime → ui → mixed → report の順にすべて動かす

公開先（AWS）で測るとき：PERF_DB=aws を付けて seed・clean すると、公開先の DB（RDS）と添付のバケットに入れる・消す。
実行する前に確かめる（-y を付けると確かめない）`

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FRONTEND = fileURLToPath(new URL('../', import.meta.url))
// Docker の -v に渡すので、末尾の区切り文字を外す
const PERF_DIR = fileURLToPath(new URL('../../perf', import.meta.url))
const RESULTS = new URL('../../perf/results/', import.meta.url)
const PLAYWRIGHT = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url))

// 測る先。公開先で測るときは CloudFront の URL を入れる（開発計画書 2-8）
const BASE_URL = process.env.PERF_BASE_URL ?? 'http://localhost:8080'
const K6_IMAGE = 'grafana/k6:2.2.0'
// 公開先（AWS）の DB と添付のバケットに入れる・消すか（PERF_DB=aws）。公開先では、API が使う DB にそのまま入れる
const ON_AWS = process.env.PERF_DB === 'aws'
const DB = ON_AWS ? 'raisechat' : 'raisechat_perf'
// 測るワークスペースの画像を置くバケット（手元は application.properties と同じ既定値）。S3_ENDPOINT があれば S3 以外（MinIO）に置く。
// 公開先のバケット名には AWS のアカウント ID が要るので、seed・clean で使うときに求める
const bucket = () => process.env.S3_BUCKET ?? (ON_AWS ? `rc-files-${accountId()}` : 'rc-files-dev-467112307516')
const IMAGES_PREFIX = 'workspaces/900000001/attachments/'
// 測るワークスペースの general の最新 50 件に付ける画像（perf/seed.sql）の数と大きさ。元の画像と縮小した画像を同じものにする
const SAMPLE_IMAGES = 200
const IMAGE_WIDTH = 320
const IMAGE_HEIGHT = 240

const START_API = `jar を perf プロファイルで起動してから、もう一度実行してください（README「性能テスト」）：
  java -jar backend/target/backend-0.0.1-SNAPSHOT.jar --spring.profiles.active=perf`

function psql(database: string, args: string[], input?: string): string {
  if (ON_AWS) return remotePsql(database, args, input)
  return execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'raisechat', '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-q', ...args], { cwd: ROOT, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] })
}

function s3(args: string[]): void {
  const endpoint = process.env.S3_ENDPOINT ? ['--endpoint-url', process.env.S3_ENDPOINT] : []
  execFileSync('aws', ['s3', ...args, ...endpoint, '--region', process.env.AWS_REGION ?? 'ap-northeast-1',
    '--only-show-errors'], { stdio: 'inherit' })
}

// 性能テストのユーザー（perf/seed.sql）だけを選ぶ条件。公開先では利用者と同じ表にあるので、ID の形と表示名の両方で絞る
const PERF_USERS = "SELECT id FROM users WHERE username ~ '^perf_[0-9]{4}$' AND display_name LIKE '性能テスト %'"

// 公開先の DB と添付のバケットは利用者が使っているものなので、入れる・消す前に確かめる
async function confirmAws(action: string): Promise<void> {
  if (!ON_AWS || process.argv.includes('-y')) return
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`公開先の DB（RDS）と添付のバケット（${bucket()}）に、性能テストのデータを${action}。よろしいですか？ [y/N] `)
  rl.close()
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('やめました')
    process.exit(1)
  }
}

// 公開先の DB は API が使っているものなので、あって表もある
const dbExists = () => ON_AWS || psql('raisechat', ['-tAc', `SELECT 1 FROM pg_database WHERE datname = '${DB}'`]).trim() === '1'

function seed(): void {
  if (!ON_AWS && !dbExists()) {
    // pg_trgm が日本語を索引に入れるよう、文字の分類は en_US.UTF-8 にする（compose.yaml と同じ）
    psql('raisechat', ['-c', `CREATE DATABASE ${DB} LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0`])
    console.log(`DB ${DB} を作りました。表は API が起動したときに Flyway が作ります。\n${START_API}`)
    process.exit(1)
  }
  if (!ON_AWS && psql(DB, ['-tAc', "SELECT to_regclass('public.users') IS NOT NULL"]).trim() !== 't') {
    console.log(`DB ${DB} に表がありません。\n${START_API}`)
    process.exit(1)
  }
  // 測るワークスペースの画像（perf-001〜perf-200 と、その縮小した画像 perf-001-thumb〜）を S3 に置く
  const dir = new URL('images/', RESULTS)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  let bytes = 0
  for (let i = 1; i <= SAMPLE_IMAGES; i++) {
    const png = noisePng(IMAGE_WIDTH, IMAGE_HEIGHT)
    bytes = png.length
    const name = `perf-${String(i).padStart(3, '0')}`
    writeFileSync(new URL(name, dir), png)
    writeFileSync(new URL(`${name}-thumb`, dir), png)
  }
  console.log(`画像 ${SAMPLE_IMAGES} 枚と縮小した画像を s3://${bucket()}/${IMAGES_PREFIX} に置きます`)
  s3(['cp', fileURLToPath(dir), `s3://${bucket()}/${IMAGES_PREFIX}`, '--recursive', '--content-type', 'image/png'])
  rmSync(dir, { recursive: true, force: true })

  console.log('データを入れます（数分かかります）')
  const sql = readFileSync(new URL('seed.sql', new URL('../../perf/', import.meta.url)), 'utf8')
  process.stdout.write(psql(DB, ['-v', `image_bytes=${bytes}`, '-v', `image_width=${IMAGE_WIDTH}`,
    '-v', `image_height=${IMAGE_HEIGHT}`, '-f', '-'], sql))
}

function clean(): void {
  if (dbExists()) {
    // N-6・N-7 の測定が途中で止まると、送った添付が S3 に残る。行を消す前に、そのファイルを消す
    const keys = psql(DB, ['-tAc', `SELECT a.storage_key FROM attachments a JOIN conversations c ON c.id = a.conversation_id
      WHERE c.workspace_id = 900000001 AND a.storage_key NOT LIKE '%/perf-%'`])
      .split(/\r?\n/).filter(Boolean)
    for (const key of keys) {
      s3(['rm', `s3://${bucket()}/${key}`])
    }
    psql(DB, [
      '-c', `DELETE FROM workspaces WHERE owner_id IN (${PERF_USERS})`,
      '-c', `DELETE FROM refresh_tokens WHERE user_id IN (${PERF_USERS})`,
      '-c', `DELETE FROM users WHERE id IN (${PERF_USERS})`,
    ])
  }
  s3(['rm', `s3://${bucket()}/${IMAGES_PREFIX}`, '--recursive'])
  console.log('性能テストのデータと画像を消しました')
}

// k6 を Docker で動かす。手元の API（localhost）には、コンテナの中から host.docker.internal でつなぐ。
// WebSocket の Origin（WEB_ORIGIN と同じでないとつながらない）は、書き換える前の URL
function k6Args(script: string, scenario: string, resultName: string, containerName: string,
  env: Record<string, string> = {}): string[] {
  const baseUrl = BASE_URL.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, '//host.docker.internal')
  // Linux では結果のファイルを書けるよう、自分のユーザーで動かす（Windows・Mac の Docker Desktop では要らない）
  const user = process.getuid && process.getgid ? ['--user', `${process.getuid()}:${process.getgid()}`] : []
  const vars = { BASE_URL: baseUrl, ORIGIN: BASE_URL, SCENARIO: scenario, RESULT_NAME: resultName, ...env }
  return ['run', '--rm', '--name', containerName, '--add-host=host.docker.internal:host-gateway', ...user,
    '-v', `${PERF_DIR}:/perf`, ...Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    K6_IMAGE, 'run', '--quiet', `/perf/k6/${script}`]
}

// 終了コード 0 なら合格。k6 は目標を外すと 99、Playwright は 1 を返す
function k6(script: string, scenario: string): boolean {
  mkdirSync(RESULTS, { recursive: true })
  return spawnSync('docker', k6Args(script, scenario, scenario, `perf-k6-${scenario}`), { stdio: 'inherit' }).status === 0
}

function playwright(env: Record<string, string> = {}, args: string[] = []): boolean {
  return spawnSync(process.execPath, [PLAYWRIGHT, 'test', '--config', 'playwright.perf.config.ts', ...args],
    { cwd: FRONTEND, stdio: 'inherit', env: { ...process.env, PERF_BASE_URL: BASE_URL, ...env } }).status === 0
}

async function mixed(): Promise<boolean> {
  mkdirSync(RESULTS, { recursive: true })
  const name = 'perf-k6-mixed'
  // 画面の測定が終わるまで負荷をかけ続け、終わったら止める（止めても k6 は結果を書き出す）
  const load = spawn('docker', k6Args('api.js', 'load', 'load-mixed', name, { LOAD_DURATION: '60m' }), { stdio: 'inherit' })
  const loadEnded = new Promise((resolve) => load.on('exit', resolve))
  console.log('50 人まで増えるのを待ちます（70 秒）')
  await sleep(70_000)
  const ok = playwright({ PERF_UNDER_LOAD: '1' }, ['--grep', 'N-1|N-2|N-3|N-4|N-5 '])
  spawnSync('docker', ['kill', '--signal=SIGINT', name], { stdio: 'ignore' })
  await loadEnded
  return ok
}

// 表に書く値。時間はミリ秒、大きさは KB
const value = (r: Result, v: number) => r.unit === 'ms' ? `${Math.round(v)}ms` : r.unit === 'KB' ? `${Math.round(v)}KB` : v.toFixed(3)

// 結果を 1 つの Markdown の表にまとめる
function report(): void {
  const parts = ['# 性能テストの結果', '', `- 日時：${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
    `- 測った先：${BASE_URL}`, '- 判定：P95（小さい順に並べて 95% の位置の値）が目標以内なら合格（基本設計書 2.4）']
  for (const name of ['api-baseline', 'api-load', 'realtime', 'api-load-mixed']) {
    const file = new URL(`k6-${name}.md`, RESULTS)
    if (existsSync(file)) parts.push(readFileSync(file, 'utf8'))
  }
  const uiDir = new URL('ui/', RESULTS)
  if (existsSync(uiDir)) {
    const results = readdirSync(uiDir).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(new URL(f, uiDir), 'utf8')) as Result)
      .toSorted((a, b) => Number(a.underLoad) - Number(b.underLoad) || a.project.localeCompare(b.project)
        || a.id.localeCompare(b.id) || a.label.localeCompare(b.label))
    parts.push('', '■ 画面の性能（Edge。下り 10Mbps・上り 30Mbps。スマートフォンは 375px・CPU 4 倍遅く）', '',
      '| 要件 | 項目 | 画面 | 負荷 | 回数 | P50 | P95 | 最大 | 目標（P95） | 判定 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...results.map((r) => `| ${r.id} | ${r.label} | ${r.project === 'pc' ? 'パソコン' : 'スマートフォン'} | `
        + `${r.underLoad ? '50 人' : 'なし'} | ${r.samples.length} | ${value(r, r.p50)} | ${value(r, r.p95)} | `
        + `${value(r, r.max)} | ${r.target === undefined ? '-' : `${value(r, r.target)} 以内`} | `
        + `${r.ok === undefined ? '参考' : r.ok ? '合格' : '不合格'} |`))
  }
  const text = parts.join('\n') + '\n'
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(new URL('summary.md', RESULTS), text)
  console.log(`\n${text}\n結果：${fileURLToPath(new URL('summary.md', RESULTS))}`)
}

const command = process.argv[2]
let ok = true
switch (command) {
  case 'seed': await confirmAws('入れます'); seed(); break
  case 'clean': await confirmAws('消します'); clean(); break
  case 'api': ok = k6('api.js', 'baseline'); break
  case 'load': ok = k6('api.js', 'load'); break
  case 'realtime': ok = k6('realtime.js', 'realtime'); break
  case 'ui': ok = playwright(); break
  case 'mixed': ok = await mixed(); break
  case 'report': report(); break
  case 'all': {
    rmSync(RESULTS, { recursive: true, force: true })
    // どれかが目標を外しても、残りも測ってから結果をまとめる
    const results = [k6('api.js', 'baseline'), k6('api.js', 'load'), k6('realtime.js', 'realtime'), playwright(), await mixed()]
    report()
    ok = results.every(Boolean)
    break
  }
  default:
    console.log(USAGE)
    ok = command === undefined
}
process.exit(ok ? 0 : 1)
