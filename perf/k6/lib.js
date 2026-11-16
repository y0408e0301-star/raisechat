// k6 のシナリオ（api.js・realtime.js）で使う共通の部品。ログイン・CSRF のトークン・JWT の取り直し・結果の書き出し
import http from 'k6/http'
import { fail } from 'k6'

// 測る先。手元は Docker の中から 8080 の API（jar）につなぐ。公開先は CloudFront の URL を渡す
export const BASE_URL = (__ENV.BASE_URL || 'http://host.docker.internal:8080').replace(/\/$/, '')
// WebSocket の Origin（API の WEB_ORIGIN と同じでないとつながらない。機能定義書 4.1）。
// 手元は画面の URL（http://localhost:8080）、公開先は CloudFront の URL
export const ORIGIN = (__ENV.ORIGIN || 'http://localhost:8080').replace(/\/$/, '')

// perf/seed.sql で入れたユーザー・ワークスペース・会話
export const PASSWORD = 'perf-pass1'
export const username = (n) => `perf_${String(n).padStart(4, '0')}`
export const WORKSPACE = 900000001
export const GENERAL = 900000001
// perf-ch-02〜perf-ch-50（1〜100 番が入っている）
export const channel = (c) => 900000000 + c

// 送信ごとの clientId（UUID。FN-07 5 章の 8）
export function uuid() {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`
}

// GET 以外の API は、Cookie の XSRF-TOKEN を X-XSRF-TOKEN ヘッダーで送り返す（機能定義書 3.2）
function xsrfHeader() {
  const token = http.cookieJar().cookiesForURL(`${BASE_URL}/api/`)['XSRF-TOKEN']
  return token ? { 'X-XSRF-TOKEN': token[0] } : {}
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// ログインする。BCrypt は重いので、測る API には含めない（タグ name=login で分ける）。
// 最初の GET で XSRF-TOKEN の Cookie を受け取ってから送る
export function login(n) {
  http.get(`${BASE_URL}/api/auth/me`, { tags: { name: 'setup' }, responseCallback: http.expectedStatuses(200, 401) })
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ username: username(n), password: PASSWORD }),
    { headers: { ...JSON_HEADERS, ...xsrfHeader() }, tags: { name: 'login' } })
  if (res.status !== 200) {
    fail(`${username(n)} でログインできません（${res.status}）。先に性能テストのデータを入れてください：npm run perf -- seed`)
  }
}

// WebSocket のつなぎ始めに送る Cookie（access_token）。k6 の WebSocket は Cookie を自動では送らない
export function cookieHeader() {
  const jar = http.cookieJar().cookiesForURL(`${BASE_URL}/`)
  return Object.entries(jar).map(([name, values]) => `${name}=${values[0]}`).join('; ')
}

// JWT（15 分で切れる）が切れていたら取り直して、もう一度送る（画面と同じ。FN-01 3.3）
function send(method, path, name, body) {
  // 測る API には api=yes を付け、失敗の割合を数える（ログイン・取り直しは数えない）
  const params = () => ({
    headers: { ...(method === 'GET' ? {} : xsrfHeader()), ...(body ? JSON_HEADERS : {}) },
    tags: { name, api: 'yes' },
  })
  const payload = body ? JSON.stringify(body) : null
  let res = http.request(method, `${BASE_URL}${path}`, payload, params())
  if (res.status === 401) {
    http.post(`${BASE_URL}/api/auth/refresh`, null, { headers: xsrfHeader(), tags: { name: 'setup' } })
    res = http.request(method, `${BASE_URL}${path}`, payload, params())
  }
  if (res.status >= 300) {
    console.error(`${method} ${path} → ${res.status} ${res.body}`)
  }
  return res
}

export const get = (path, name) => send('GET', path, name)
export const post = (path, name, body) => send('POST', path, name, body)
export const put = (path, name, body) => send('PUT', path, name, body)
export const del = (path, name) => send('DELETE', path, name)

// 結果を、表（画面に出す）と JSON・Markdown（perf/results/ に残す）にする。
// targets は { 名前: { id, label, ms, metric? } }。metric を省くと http_req_duration{name:名前}
export function summary(data, name, title, targets) {
  const rows = Object.entries(targets).map(([key, target]) => {
    const metric = data.metrics[target.metric ?? `http_req_duration{name:${key}}`]
    if (!metric || metric.values.count === undefined) {
      return { name: key, ...target, count: 0 }
    }
    const v = metric.values
    return {
      name: key, ...target, count: v.count ?? 0,
      p50: v['p(50)'], p95: v['p(95)'], p99: v['p(99)'], max: v.max,
      ok: v['p(95)'] < target.ms,
    }
  }).filter((row) => row.count > 0)
  const failed = data.metrics['http_req_failed{api:yes}']?.values.rate ?? 0
  const ms = (value) => value === undefined ? '-' : `${Math.round(value)}ms`
  const lines = [
    '',
    `■ ${title}`,
    '',
    '| 要件 | 項目 | 回数 | P50 | P95 | P99 | 最大 | 目標（P95） | 判定 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.id} | ${r.label} | ${r.count} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.p99)} | ${ms(r.max)} | ${r.ms}ms 以内 | ${r.ok ? '合格' : '不合格'} |`),
    '',
    `失敗した応答の割合：${(failed * 100).toFixed(2)}%（1% 未満で合格）`,
    '',
  ]
  return {
    stdout: lines.join('\n'),
    [`/perf/results/k6-${name}.json`]: JSON.stringify({ name, baseUrl: BASE_URL, rows, failedRate: failed }, null, 2),
    [`/perf/results/k6-${name}.md`]: lines.join('\n'),
  }
}

// 目標の P95（ミリ秒）を k6 の thresholds にする。目標を外すと k6 は終了コード 99 で終わる
export function thresholds(targets) {
  const result = { 'http_req_failed{api:yes}': ['rate<0.01'] }
  for (const [key, target] of Object.entries(targets)) {
    result[target.metric ?? `http_req_duration{name:${key}}`] = [`p(95)<${target.ms}`]
  }
  return result
}
