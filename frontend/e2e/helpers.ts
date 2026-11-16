import { expect, test } from '@playwright/test'
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test'

// E2E のテストで共通に使う部品。ユーザーを作る・ログインする・API を直接呼ぶ・ワークスペースと会話を用意する・
// メッセージを送る

export type User = { username: string, displayName: string }

export const PASSWORD = 'e2e-pass1'

// 1×1 の PNG（添付・アバターのテストで使う）
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

export const pngFile = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG })

// 前の実行の消し残しと重ならないように、時刻を付ける
const run = Date.now().toString(36).slice(-6)

// この実行とこの project だけを表す文字（project の名前の頭文字）。ユーザー ID と表示名・ワークスペース名に入れる
export const runId = () => `${run}${test.info().project.name[0]}`

// ユーザー ID は 15 文字まで（「e2e_」4 文字 ＋ runId 7 文字 ＋ suffix 4 文字まで）。suffix はファイルをまたいで重ならないようにする
export const user = (suffix: string, name: string): User =>
  ({ username: `e2e_${runId()}${suffix}`, displayName: `${name} ${runId()}${suffix}` })

// テストの中で開いたブラウザ。テストが終わったら closeContexts で閉じる
const opened = new Set<BrowserContext>()

// ページごとに、WebSocket で送った STOMP のフレーム（購読が済んだかを見るため）
const sentFrames = new WeakMap<Page, string[]>()

function trackFrames(page: Page): void {
  const frames: string[] = []
  sentFrames.set(page, frames)
  page.on('websocket', (ws) => ws.on('framesent', (frame) => frames.push(String(frame.payload))))
}

// project の設定（baseURL・画面の幅・端末のエミュレーションなど）で、Cookie を分けた新しいブラウザを開く
export async function newContext(browser: Browser): Promise<BrowserContext> {
  const { baseURL, viewport, locale, timezoneId, isMobile, hasTouch, userAgent, deviceScaleFactor } = test.info().project.use
  const context = await browser.newContext({ baseURL, viewport, locale, timezoneId, isMobile, hasTouch, userAgent, deviceScaleFactor })
  context.on('page', trackFrames)
  opened.add(context)
  return context
}

// テストで開いたブラウザを閉じる。各ファイルの test.afterEach で呼ぶ
export async function closeContexts(): Promise<void> {
  await Promise.all([...opened].map((context) => context.close()))
  opened.clear()
}

export const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1280) < 600

// G-2 の入力欄を埋めて「登録する」を押す（ページはもう G-2 を開いている）
export async function fillSignup(page: Page, { username, displayName }: User): Promise<void> {
  await page.getByLabel('ユーザー ID').fill(username)
  await page.getByLabel('表示名').fill(displayName)
  await page.getByLabel('パスワード', { exact: true }).fill(PASSWORD)
  await page.getByLabel('パスワード（確認）').fill(PASSWORD)
  await page.getByRole('button', { name: '登録する' }).click()
}

// 新しいブラウザで G-2 から登録し、ログインした状態（G-3）のページを返す
export async function signup(browser: Browser, who: User): Promise<Page> {
  const page = await (await newContext(browser)).newPage()
  await page.goto('/signup')
  await fillSignup(page, who)
  await expect(page.getByRole('heading', { name: 'ワークスペース', exact: true })).toBeVisible()
  return page
}

// G-1 で ID とパスワードを入れてログインのボタンを押す。結果は呼んだ側で確かめる
export async function submitLogin(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel('ユーザー ID').fill(username)
  await page.getByLabel('パスワード').fill(password)
  await page.getByRole('button', { name: 'ログイン' }).click()
}

// API を呼ぶ（そのページのログインの Cookie を使う。読むだけなので CSRF のトークンは要らない）
export async function api<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(path)
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true)
  return (await res.json()) as T
}

// GET 以外の API を画面の外から呼ぶときの CSRF のヘッダー（機能定義書 3.2）。
// XSRF-TOKEN の Cookie は API の応答で届くので、まだなければ先に GET で受け取る
export async function xsrfHeader(page: Page): Promise<Record<string, string>> {
  const find = async () => (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')
  let token = await find()
  if (!token) {
    await page.request.get('/api/auth/me')
    token = await find()
  }
  expect(token, 'XSRF-TOKEN の Cookie がありません').toBeDefined()
  return { 'X-XSRF-TOKEN': decodeURIComponent(token!.value) }
}

// GET 以外の API を画面の外から呼び、成功したことを確かめて応答の本文を返す（データを用意するとき）
export async function send<T>(page: Page, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string,
  data?: unknown): Promise<T> {
  const res = await page.request.fetch(path, { method, headers: await xsrfHeader(page), data })
  expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBe(true)
  return (res.status() === 204 ? undefined : await res.json()) as T
}

// 断られることを確かめるときの、GET 以外の API（CSRF のヘッダーは付ける）
export async function status(page: Page, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string,
  data?: unknown): Promise<number> {
  const headers = method === 'GET' ? {} : await xsrfHeader(page)
  return (await page.request.fetch(path, { method, headers, data })).status()
}

export type Workspace = { id: number, name: string, generalConversationId: number }
export type Conversation = { id: number, name: string | null }
export type Message = { id: number, body: string }

// 画面を通さずにワークスペースを作る。名前は 50 文字まで
export const createWorkspace = (page: Page, label: string): Promise<Workspace> =>
  send<Workspace>(page, 'POST', '/api/workspaces', { name: `${label} ${runId()}` })

// オーナーが招待リンクを作り、members がそれぞれ参加する（画面を通さない。G-4 を確かめないテストで）
export async function join(owner: Page, workspace: Workspace, ...members: Page[]): Promise<void> {
  const { url } = await send<{ url: string }>(owner, 'POST', `/api/workspaces/${workspace.id}/invites`)
  const token = url.split('/invite/')[1]
  for (const member of members) await send(member, 'POST', `/api/invites/${token}/accept`)
}

export const createChannel = (page: Page, workspace: Workspace, name: string,
  visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC', description = ''): Promise<Conversation> =>
  send<Conversation>(page, 'POST', `/api/workspaces/${workspace.id}/channels`, { name, description, visibility })

export const postMessage = (page: Page, conversationId: number, body: string): Promise<Message> =>
  send<Message>(page, 'POST', `/api/conversations/${conversationId}/messages`, { body, clientId: crypto.randomUUID() })

export const postReply = (page: Page, parentId: number, body: string): Promise<Message> =>
  send<Message>(page, 'POST', `/api/messages/${parentId}/replies`, { body, clientId: crypto.randomUUID() })

export const conversationPath = (workspace: Workspace, conversationId: number) => `/w/${workspace.id}/c/${conversationId}`

// 会話を開き、最初の読み込みとリアルタイムの購読が済むのを待つ。購読の前に送られた通知は届かないので、
// ほかの人が送る前に済ませておく
export async function openConversation(page: Page, workspace: Workspace, conversationId: number,
  kind: 'c' | 'd' = 'c'): Promise<void> {
  await page.goto(`/w/${workspace.id}/${kind}/${conversationId}`)
  await expect(composer(page)).toBeVisible()
  await subscribed(page, `/topic/conversations/${conversationId}`)
}

export const USER_QUEUE = '/user/queue/events'

// その宛先を count 回目まで購読したのを待つ（SUBSCRIBE のフレームを送ってから、サーバーが受け付けるまで少し待つ）。
// つなぎ直すと購読し直すので、count で何回目かを指定する
export async function subscribed(page: Page, destination: string, count = 1): Promise<void> {
  const frames = sentFrames.get(page)
  expect(frames, 'newContext で開いたページではありません').toBeDefined()
  // 「/」で終わる宛先は、その下のどれか（例：/topic/conversations/ は、どれかの会話）
  const target = destination.endsWith('/') ? `destination:${destination}` : `destination:${destination}\n`
  await expect.poll(() => frames!.filter((f) => f.startsWith('SUBSCRIBE') && f.includes(target)).length,
    { message: `${destination} の購読`, timeout: 10_000 }).toBeGreaterThanOrEqual(count)
  await page.waitForTimeout(300)
}

// 会話の入力欄（プレースホルダーは「# 名前 へのメッセージ」か「相手 へのメッセージ」）。
// スレッドのパネルの入力欄（「返信する…」）も同じ「メッセージ」という名前なので、プレースホルダーで見分ける
export const composer = (page: Page) => page.getByPlaceholder(/ へのメッセージ$/)

export const thread = (page: Page) => page.getByRole('complementary', { name: 'スレッド' })

// スレッドのパネルを閉じる。600px 未満では「✕」の代わりに「←」（会話に戻る）を出す（画面設計書 7.2）
export async function closeThread(page: Page): Promise<void> {
  await thread(page).getByRole('button', { name: isNarrow(page) ? '会話に戻る' : 'スレッドを閉じる' }).click()
  await expect(thread(page)).toHaveCount(0)
}

// 入力欄に書いて Enter で送る
export async function sendFrom(input: Locator, text: string): Promise<void> {
  await input.fill(text)
  await input.press('Enter')
}

// 会話の一覧にあるメッセージ（本文で探す）
export const messageItem = (scope: Page | Locator, author: User, text: string) =>
  scope.getByRole('article', { name: `${author.displayName}のメッセージ` }).filter({ hasText: text })

// メッセージの操作（😀・💬・✎・🗑）を押す。マウスではメッセージに重ねると右上に出る。
// タッチの画面（mobile）では長押しで下からのメニューに出る（画面設計書 2.9）
export async function messageAction(item: Locator, action: 'リアクション' | 'スレッドで返信' | '編集' | '削除'): Promise<void> {
  if (isNarrow(item.page())) {
    await longPress(item)
  } else {
    await item.hover()
  }
  await item.getByRole('button', { name: action, exact: true }).click()
}

// 指で長押しする（押したまま 0.6 秒待って離す）
export async function longPress(target: Locator): Promise<void> {
  const box = (await target.boundingBox())!
  const at = { pointerType: 'touch', isPrimary: true, clientX: box.x + 8, clientY: box.y + 8 }
  await target.dispatchEvent('pointerdown', at)
  await target.page().waitForTimeout(600)
  await target.dispatchEvent('pointerup', at)
}

// 画面の横幅が 600px 未満のときは、サイドバーを開いてから押す（画面設計書 2.19）
export async function sidebar(page: Page): Promise<Locator> {
  const nav = page.getByRole('navigation', { name: '会話' })
  if (isNarrow(page) && !(await nav.isVisible())) await page.getByRole('button', { name: 'サイドバーに戻る' }).click()
  return nav
}

// トースト（画面設計書 2.4）
export const toast = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('button', { name: '閉じる' }) })

export type Attachment = { id: number }

// 画面を通さずに画像を添付として送る（API で受け付け → S3 に直接 PUT → complete）。添付の ID を返す
export async function uploadImage(page: Page, conversationId: number, fileName: string): Promise<Attachment> {
  const ticket = await send<{ uploadId: number, putUrl: string, headers: Record<string, string> }>(page, 'POST',
    `/api/conversations/${conversationId}/uploads`, { fileName, contentType: 'image/png', size: PNG.length })
  const put = await page.request.put(ticket.putUrl, { headers: ticket.headers, data: PNG })
  expect(put.ok(), `S3 への PUT → ${put.status()}`).toBe(true)
  return send<Attachment>(page, 'POST', `/api/uploads/${ticket.uploadId}/complete`)
}

export const postWithAttachments = (page: Page, conversationId: number, body: string,
  attachments: Attachment[]): Promise<Message> =>
  send<Message>(page, 'POST', `/api/conversations/${conversationId}/messages`,
    { body, clientId: crypto.randomUUID(), attachmentIds: attachments.map((a) => a.id) })
