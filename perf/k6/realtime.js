// リアルタイムの通知の性能テスト（開発計画書 2-2、基本設計書 2.4「リアルタイムの通知の測り方」）。
// 50 人（RECEIVERS。11.1 の同時に WebSocket でつないでいる人）が WebSocket でつないで購読し、1 人（perf_0051）が送ってから、
// 全員に届くまでの時間を測る。
//   N-3：general に送る → general を購読している全員に message.created が届くまで
//   N-4：perf-ch-02 に送る → 本人あての通知（/user/queue/events）で、全員に未読の件数（conversation.updated）が届くまで
// 送るのは、測り始めの時刻（setup で決める）から INTERVAL ミリ秒おき。偶数番目は general、奇数番目は perf-ch-02 に送る。
// 届いた時刻から、その送信の時刻（送り始め）を引いて測る（k6 の中の時計は 1 つなので、送る人と受ける人で同じ時計を使う）
import { sleep } from 'k6'
import exec from 'k6/execution'
import { Trend } from 'k6/metrics'
import { setTimeout } from 'k6/timers'
import { WebSocket } from 'k6/websockets'
import { BASE_URL, channel, cookieHeader, del, GENERAL, login, ORIGIN, post, summary, thresholds, uuid } from './lib.js'

const RECEIVERS = Number(__ENV.RECEIVERS || 50)
const SENDS = Number(__ENV.SENDS || 60)
const INTERVAL = 2000
// 全員がつないで購読し終えるまで待つ時間
const WARMUP = 30_000
const COUNTED = channel(2)

const messageLatency = new Trend('realtime_message', true)
const countLatency = new Trend('realtime_count', true)

const TARGETS = {
  realtime_message: { id: 'N-3', label: `送ってから、同じ会話を開いている ${RECEIVERS} 人に届くまで`, ms: 1000, metric: 'realtime_message' },
  realtime_count: { id: 'N-4', label: `送ってから、${RECEIVERS} 人に未読の件数が届くまで`, ms: 1000, metric: 'realtime_count' },
  rt_send: { id: 'N-3', label: 'メッセージの送信（API）', ms: 500 },
}

export const options = {
  scenarios: {
    receivers: { executor: 'per-vu-iterations', exec: 'receive', vus: RECEIVERS, iterations: 1, maxDuration: '10m' },
    sender: { executor: 'per-vu-iterations', exec: 'sendAll', vus: 1, iterations: 1, maxDuration: '10m' },
  },
  // 届かなかった通知の数は、結果の表の下に出す
  thresholds: thresholds(TARGETS),
  summaryTrendStats: ['p(50)', 'p(95)', 'p(99)', 'max', 'count'],
}

export function setup() {
  return { start: Date.now() + WARMUP }
}

const sentAt = (data, i) => data.start + i * INTERVAL

// STOMP のフレーム（機能定義書 4.1。画面は @stomp/stompjs で同じものを送る）
const frame = (command, headers, body = '') =>
  `${command}\n${Object.entries(headers).map(([k, v]) => `${k}:${v}`).join('\n')}\n\n${body}\u0000`

function parse(text) {
  const [head, ...rest] = text.split('\n\n')
  const [command, ...lines] = head.split('\n')
  const headers = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]))
  return { command, headers, body: rest.join('\n\n').replace(/\u0000$/, '') }
}

// 受ける人（1〜50 番）。general と本人あての通知を購読し、送り終わるまでつないでおく
export function receive(data) {
  // VU の番号は送る人の分も通しで付くので、この scenario の中の番号（0〜49）で人を決める（送る人の 51 番と重ねない）
  const n = exec.scenario.iterationInTest + 1
  login(n)
  // 件数の通知は、1 つの送信で何回か届くことがある（送った人の既読など）。送信ごとに最初の 1 回だけ数える
  const counted = new Set()
  const url = `${BASE_URL.replace(/^http/, 'ws')}/ws`
  const ws = new WebSocket(url, null, { headers: { Cookie: cookieHeader(), Origin: ORIGIN } })
  ws.onopen = () => ws.send(frame('CONNECT', { 'accept-version': '1.2', 'heart-beat': '0,0', host: 'raisechat' }))
  ws.onmessage = (e) => {
    const received = Date.now()
    const { command, headers, body } = parse(e.data)
    if (command === 'CONNECTED') {
      ws.send(frame('SUBSCRIBE', { id: 'sub-0', destination: `/topic/conversations/${GENERAL}` }))
      ws.send(frame('SUBSCRIBE', { id: 'sub-1', destination: '/user/queue/events' }))
      return
    }
    if (command === 'ERROR') {
      console.error(`${n}: STOMP の ERROR ${headers.message ?? ''} ${body}`)
      return
    }
    if (command !== 'MESSAGE') return
    const event = JSON.parse(body)
    if (event.type === 'message.created' && event.conversationId === GENERAL) {
      const match = /perf-rt:(\d+)/.exec(event.payload.body)
      if (match) messageLatency.add(received - sentAt(data, Number(match[1])))
    }
    if (event.type === 'conversation.updated' && event.payload.id === COUNTED) {
      // 件数の通知には送った番号がないので、届いた時刻の直前の送信（奇数番目）のものとみなす
      // 送り終わった後の通知（送ったメッセージを消したとき）は数えない
      const i = Math.floor((received - data.start) / INTERVAL)
      const odd = i % 2 === 1 ? i : i - 1
      if (odd >= 1 && odd < SENDS && !counted.has(odd)) {
        counted.add(odd)
        countLatency.add(received - sentAt(data, odd))
      }
    }
  }
  ws.onerror = (e) => console.error(`${n}: WebSocket のエラー ${e.error}`)
  setTimeout(() => ws.close(), Math.max(0, sentAt(data, SENDS) + 3000 - Date.now()))
}

// 送る人（perf_0051）。決めた時刻ごとに送り、終わったら送ったメッセージを消す（データを元に戻す）
export function sendAll(data) {
  login(51)
  const sent = []
  for (let i = 0; i < SENDS; i++) {
    const wait = sentAt(data, i) - Date.now()
    if (wait > 0) sleep(wait / 1000)
    const to = i % 2 === 0 ? GENERAL : COUNTED
    const res = post(`/api/conversations/${to}/messages`, 'rt_send',
      { body: `性能テスト perf-rt:${i}`, clientId: uuid(), attachmentIds: [] })
    if (res.status === 201 || res.status === 200) sent.push(res.json('id'))
  }
  sleep(3)
  for (const id of sent) del(`/api/messages/${id}`, 'cleanup')
}

export function handleSummary(data) {
  const result = summary(data, 'realtime', `リアルタイムの通知：${RECEIVERS} 人がつないでいるとき`, TARGETS)
  const expected = { realtime_message: Math.ceil(SENDS / 2) * RECEIVERS, realtime_count: Math.floor(SENDS / 2) * RECEIVERS }
  const missing = Object.entries(expected).map(([key, count]) =>
    `${TARGETS[key].id}：届くはずの通知 ${count} 件のうち、届いたもの ${data.metrics[key]?.values.count ?? 0} 件`)
  const note = `\n${missing.join('\n')}\n`
  result.stdout += note
  result['/perf/results/k6-realtime.md'] += note
  return result
}
