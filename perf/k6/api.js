// API の性能テスト（開発計画書 2-2、基本設計書 2.4）。要件定義書 11.1 の N-1・N-2・N-5 の API と、送信・既読・リアクションを
// P95 で判定する（画面での時間は frontend/perf/ui.spec.ts で測る）。
// 環境変数 SCENARIO で測り方を選ぶ（frontend/perf/cli.ts から Docker の grafana/k6 で動かす）。
//   baseline … 1 人で各 API を順に 50 回ずつ呼ぶ（基準の測定）
//   load     … 50 人（LOAD_VUS。11.1 の同時にログインしている人）が同時に使う。考える時間を挟みながら 5 分（LOAD_DURATION）
import { sleep } from 'k6'
import { channel, del, get, GENERAL, login, post, put, summary, thresholds, uuid, WORKSPACE } from './lib.js'

const SCENARIO = __ENV.SCENARIO || 'baseline'
const LOAD_VUS = Number(__ENV.LOAD_VUS || 50)
const LOAD_DURATION = __ENV.LOAD_DURATION || '5m'

// 測る API と目標（ミリ秒）。画面の目標（N-1 は 3 秒、N-2 は 1 秒、N-5 は 2 秒）は、画面が呼ぶ API の合計と描画を含むので、
// API はそれぞれ、その中に十分収まる値を目安にする
const TARGETS = {
  workspaces: { id: 'N-1', label: 'ワークスペースの一覧（G-3）', ms: 1000 },
  workspace: { id: 'N-1', label: 'ワークスペースの詳細（件数を含む）', ms: 1000 },
  conversations: { id: 'N-1', label: 'サイドバーの会話（未読・メンションの件数を含む）', ms: 1000 },
  conversation: { id: 'N-1・N-2', label: '会話の詳細', ms: 500 },
  messages: { id: 'N-1・N-2', label: '最新 50 件のメッセージ', ms: 500 },
  older: { id: 'MS-2', label: '前の 50 件のメッセージ', ms: 500 },
  send: { id: 'N-3', label: 'メッセージの送信', ms: 500 },
  read: { id: 'N-4', label: '既読の記録', ms: 500 },
  react: { id: 'N-3', label: 'リアクションを付ける', ms: 500 },
  unreact: { id: 'N-3', label: 'リアクションを外す', ms: 500 },
  replies: { id: 'TH-6', label: 'スレッドの返信の一覧', ms: 500 },
  mentions: { id: 'NT-5', label: 'メンションの一覧（G-7）', ms: 1000 },
  search_rare: { id: 'N-5', label: '検索：3 文字以上の言葉（まれ）', ms: 2000 },
  search_common2: { id: 'N-5', label: '検索：2 文字の言葉（よくある）', ms: 2000 },
  search_1char: { id: 'N-5', label: '検索：1 文字の言葉', ms: 2000 },
  search_none2: { id: 'N-5', label: '検索：見つからない 2 文字の言葉', ms: 2000 },
  search_two: { id: 'N-5', label: '検索：2 つの言葉', ms: 2000 },
}

const scenarios = {
  baseline: { executor: 'per-vu-iterations', vus: 1, iterations: 50, maxDuration: '15m' },
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: LOAD_VUS },
      { duration: LOAD_DURATION, target: LOAD_VUS },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '30s',
  },
}

export const options = {
  scenarios: { [SCENARIO]: scenarios[SCENARIO] },
  thresholds: thresholds(TARGETS),
  summaryTrendStats: ['p(50)', 'p(95)', 'p(99)', 'max', 'count'],
  // ログインの Cookie を、繰り返しの間も持ち続ける（既定では 1 回ごとに消える）
  noCookiesReset: true,
}

const SEARCHES = {
  search_rare: 'まれなさがしもの',
  search_common2: '会議',
  search_1char: '旅',
  search_none2: 'ぬゑ',
  search_two: '資料 確認',
}

let loggedIn = false

// N-1：G-3 で選んでから、チャット画面（general）が出るまでに画面が呼ぶ API
function openWorkspace() {
  get('/api/workspaces', 'workspaces')
  get(`/api/workspaces/${WORKSPACE}`, 'workspace')
  get(`/api/workspaces/${WORKSPACE}/conversations`, 'conversations')
  return openConversation(GENERAL)
}

// N-2：会話を開いたときに画面が呼ぶ API。読み込んだ最後まで読んだことにする
function openConversation(id) {
  get(`/api/conversations/${id}`, 'conversation')
  const res = get(`/api/conversations/${id}/messages`, 'messages')
  const items = res.status === 200 ? res.json('items') : []
  if (items.length > 0) {
    post(`/api/conversations/${id}/read`, 'read', { lastMessageId: items[items.length - 1].id })
  }
  return items
}

function search(key) {
  get(`/api/workspaces/${WORKSPACE}/search?q=${encodeURIComponent(SEARCHES[key])}`, key)
}

// 送って、すぐ消す（データを元に戻す。消すのは測らない）。送る先は、ほかの測定で開かない perf-ch-45
function sendAndDelete(iteration) {
  const res = post(`/api/conversations/${channel(45)}/messages`, 'send',
    { body: `性能テストの送信 ${__VU}-${iteration}`, clientId: uuid(), attachmentIds: [] })
  if (res.status === 201 || res.status === 200) {
    del(`/api/messages/${res.json('id')}`, 'cleanup')
  }
}

// リアクションを付けて外す（データを元に戻す）。もともと付いていた絵文字と重ならないよう、使っていない絵文字にする
function toggleReaction(items) {
  if (items.length === 0) return
  const id = items[Math.floor(Math.random() * items.length)].id
  const emoji = encodeURIComponent('🦄')
  put(`/api/messages/${id}/reactions/${emoji}`, 'react')
  del(`/api/messages/${id}/reactions/${emoji}`, 'unreact')
}

function threadOf(items) {
  const parent = items.find((m) => m.replyCount > 0)
  if (parent) get(`/api/messages/${parent.id}/replies`, 'replies')
}

// 1 人で、各 API を 1 回ずつ順に呼ぶ（これを 50 回）
function baseline(iteration) {
  const items = openWorkspace()
  const other = openConversation(channel(2 + (iteration % 40)))
  if (other.length > 0) get(`/api/conversations/${channel(2 + (iteration % 40))}/messages?before=${other[0].id}`, 'older')
  threadOf(items)
  get(`/api/workspaces/${WORKSPACE}/mentions`, 'mentions')
  for (const key of Object.keys(SEARCHES)) search(key)
  sendAndDelete(iteration)
  toggleReaction(items)
}

// 利用者の 1 回の操作。会話を開き、ときどき別の会話・スレッド・検索・送信・リアクション・メンションの一覧
function session(iteration) {
  const items = Math.random() < 0.2 ? openWorkspace() : openConversation(channel(2 + Math.floor(Math.random() * 44)))
  sleep(2 + Math.random() * 3)
  const r = Math.random()
  if (r < 0.2) {
    sendAndDelete(iteration)
  } else if (r < 0.35) {
    toggleReaction(items)
  } else if (r < 0.5) {
    threadOf(items)
  } else if (r < 0.6) {
    const keys = Object.keys(SEARCHES)
    search(keys[Math.floor(Math.random() * keys.length)])
  } else if (r < 0.65) {
    get(`/api/workspaces/${WORKSPACE}/mentions`, 'mentions')
  }
  sleep(2 + Math.random() * 3)
}

export default function () {
  // VU（仮想の利用者）ごとに別のユーザーでログインする（1〜50 番。画面の測定は 61〜64 番を使う）
  if (!loggedIn) {
    login(__VU)
    loggedIn = true
  }
  if (SCENARIO === 'baseline') {
    baseline(__ITER)
  } else {
    session(__ITER)
  }
}

// 結果のファイル名（mixed のときは load-mixed）と、表の見出し
const RESULT_NAME = __ENV.RESULT_NAME || SCENARIO
const TITLES = {
  baseline: 'API の性能：1 人で順に 50 回（基準の測定）',
  load: `API の性能：${LOAD_VUS} 人の同時アクセス`,
  'load-mixed': `API の性能：${LOAD_VUS} 人の同時アクセス（画面の測定と同時）`,
}

export function handleSummary(data) {
  return summary(data, `api-${RESULT_NAME}`, TITLES[RESULT_NAME] ?? RESULT_NAME, TARGETS)
}
