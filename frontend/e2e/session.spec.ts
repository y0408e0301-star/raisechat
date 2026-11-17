import { expect, test } from '@playwright/test'
import type { BrowserContext, Cookie, WebSocketRoute } from '@playwright/test'
import {
  closeContexts, composer, createWorkspace, fillSignup, join, messageItem, newContext, postMessage, sendFrom, signup, user, xsrfHeader,
} from './helpers.ts'

test.afterEach(closeContexts)

// ログインの続き（FN-01 A-8）と、通信が切れたとき（N-9、機能定義書 4.4）。
// JWT（access_token）は 15 分で Cookie ごと消えるので、15 分待つ代わりに Cookie を消して、
// リフレッシュトークン（refresh_token）で取り直せることを確かめる

const cookie = async (context: BrowserContext, name: string): Promise<Cookie | undefined> =>
  (await context.cookies()).find((c) => c.name === name)

test('JWT が切れても、リフレッシュトークンで取り直して使い続けられる', async ({ browser }) => {
  const taro = user('ta', 'たろう')
  const page = await signup(browser, taro)
  const context = page.context()
  const workspace = await createWorkspace(page, '取り直し')

  await context.clearCookies({ name: 'access_token' })
  await page.goto(`/w/${workspace.id}`)
  await expect(composer(page)).toBeVisible()
  // 書き込みもできる（取り直しの後に CSRF のトークンも使える）
  await context.clearCookies({ name: 'access_token' })
  // 送った直後は、取り直し → 送信の途中でも画面に出る。保存されたのを待ってから読み直す（#65）
  const sent = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/conversations\/\d+\/messages$/.test(r.url()) && r.status() === 201)
  await sendFrom(composer(page), '取り直した後のメッセージ')
  await sent
  await expect(messageItem(page, taro, '取り直した後のメッセージ')).not.toContainText('送信できませんでした。')
  await page.reload()
  await expect(messageItem(page, taro, '取り直した後のメッセージ')).toBeVisible()
  expect(await cookie(context, 'access_token')).toBeDefined()

  // リフレッシュトークンも消えたら、G-1 に戻る
  await context.clearCookies({ name: 'access_token' })
  await context.clearCookies({ name: 'refresh_token' })
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

test('ログアウトした後は、前のリフレッシュトークンを使えない（N-24）', async ({ browser }) => {
  const page = await signup(browser, user('tb', 'はなこ'))
  const context = page.context()
  const refresh = await cookie(context, 'refresh_token')
  expect(refresh).toBeDefined()

  await page.getByRole('button', { name: 'ログアウト' }).click()
  await expect(page).toHaveURL(/\/login$/)

  // 盗まれた Cookie を後から使われた場合と同じ
  await context.addCookies([refresh!])
  const res = await page.request.post('/api/auth/refresh', { headers: await xsrfHeader(page) })
  expect(res.status()).toBe(401)
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

test('一度使ったリフレッシュトークンをもう一度使うと、その人のトークンがすべて無効になる', async ({ browser }) => {
  const page = await signup(browser, user('tc', 'じろう'))
  const context = page.context()
  const first = await cookie(context, 'refresh_token')

  // 取り直すと、リフレッシュトークンも新しくなる
  await context.clearCookies({ name: 'access_token' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ワークスペース', exact: true })).toBeVisible()
  expect((await cookie(context, 'refresh_token'))?.value).not.toBe(first?.value)

  // 古いもの（盗まれたもの）を別のブラウザで使うと断られ、本人の新しいトークンも無効になる。
  // 画面を開くと画面自身が取り直しを試みて競合するので、API だけを呼ぶ
  const thief = await newContext(browser)
  await thief.addCookies([first!])
  await thief.request.get('/api/auth/me')
  const xsrf = (await thief.cookies()).find((c) => c.name === 'XSRF-TOKEN')
  expect(xsrf).toBeDefined()
  const stolen = await thief.request.post('/api/auth/refresh', { headers: { 'X-XSRF-TOKEN': decodeURIComponent(xsrf!.value) } })
  expect(stolen.status()).toBe(401)

  await context.clearCookies({ name: 'access_token' })
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

test('インターネットが切れたらお知らせ欄に M-50 を出し、戻ったら消す', async ({ browser }) => {
  const page = await signup(browser, user('td', 'さぶろう'))
  const notice = page.getByRole('banner').getByRole('alert')

  await page.context().setOffline(true)
  await expect(notice).toHaveText('インターネットに接続されていません。接続を確認してください。')
  await page.context().setOffline(false)
  await expect(notice).toBeHidden()
})

// N-9 WebSocket が切れたら M-37 を出してつなぎ直し、切れていた間のメッセージと未読を取り直す
test('WebSocket が切れている間のメッセージも、つなぎ直した後に出る', async ({ browser }) => {
  const taro = user('te', 'たろう')
  const hana = user('tf', 'はなこ')
  const page = await signup(browser, taro)
  const workspace = await createWorkspace(page, 'つなぎ直し')

  // はなこの WebSocket は、ここを通してサーバーにつなぐ。down の間はつなげず、すぐ切る
  const context = await newContext(browser)
  const sockets: WebSocketRoute[] = []
  const sent: string[] = []
  let down = false
  await context.routeWebSocket(/\/ws$/, (ws) => {
    if (down) {
      void ws.close()
      return
    }
    const server = ws.connectToServer()
    ws.onMessage((message) => {
      sent.push(String(message))
      server.send(message)
    })
    sockets.push(ws)
  })
  const hanaPage = await context.newPage()
  await hanaPage.goto('/signup')
  await fillSignup(hanaPage, hana)
  await expect(hanaPage.getByRole('heading', { name: 'ワークスペース', exact: true })).toBeVisible()
  await join(page, workspace, hanaPage)
  const general = workspace.generalConversationId
  const subscribedCount = () => sent.filter((f) => f.startsWith('SUBSCRIBE') && f.includes(`/topic/conversations/${general}\n`)).length

  await hanaPage.goto(`/w/${workspace.id}/c/${general}`)
  await expect(composer(hanaPage)).toBeVisible()
  // 開発中の画面（React の StrictMode）は購読を 2 回やり直すことがあるので、数は切る前と比べる
  await expect.poll(subscribedCount).toBeGreaterThan(0)
  await hanaPage.waitForTimeout(500)
  const before = subscribedCount()

  // 切る。つなぎ直せない間は M-37 を出し続ける。その間にたろうが送る
  down = true
  await sockets.at(-1)!.close()
  const notice = hanaPage.getByRole('banner').getByRole('alert')
  await expect(notice).toHaveText('接続が切れました。再接続しています…')
  await postMessage(page, general, '切れている間のメッセージ')
  await expect(messageItem(hanaPage, taro, '切れている間のメッセージ')).toHaveCount(0)

  // つなげるようにすると、つなぎ直して購読し直し、取りこぼしたメッセージを出す
  down = false
  await expect.poll(subscribedCount, { timeout: 15_000 }).toBeGreaterThan(before)
  await expect(notice).toBeHidden()
  await expect(messageItem(hanaPage, taro, '切れている間のメッセージ')).toBeVisible()
  // つなぎ直した後のメッセージは、これまでどおりすぐに出る
  await postMessage(page, general, 'つなぎ直した後のメッセージ')
  await expect(messageItem(hanaPage, taro, 'つなぎ直した後のメッセージ')).toBeVisible()
})
