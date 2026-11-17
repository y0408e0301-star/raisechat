import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  channel, channelName, fillLogin, GENERAL, loggedIn, newContext, now, RUNS, record, throttle, UNDER_LOAD, username, watchFor,
  WORKSPACE, xsrfHeader,
} from './measure.ts'
import { noisePng } from './png.ts'

// 画面の性能テスト（開発計画書 2-2、基本設計書 2.4）。要件定義書 11.1 の「画面に出るまで」を、ブラウザで押してから
// 表示されるまでの時間で測り、RUNS 回（20 回）の P95 で判定する。データは perf/seed.sql で入れておく。
// 動かし方は frontend/perf/cli.ts（npm run perf -- ui / mixed）。
// 2 人の画面にまたがる時間（N-3・N-4・N-6・N-7）は、送る人が押した時刻と、相手の画面に出た時刻（MutationObserver）の差で測る

const conversationUrl = (id: number) => `/w/${WORKSPACE}/c/${id}`

// メッセージの一覧（スレッドのパネルは除く）に count 件以上出ている。name を渡すと、その会話の見出しになっていること
const listShown = (count: number, name?: string) => `(${name ? `document.querySelector('main h1')?.textContent?.includes(${JSON.stringify(name)}) && ` : ''}`
  + `[...document.querySelectorAll('main article')].filter((a) => !a.closest('aside')).length >= ${count})`

const messageShown = (text: string) => `[...document.querySelectorAll('main article')].some((a) => a.textContent.includes(${JSON.stringify(text)}))`

// 会話を開き、最初の 50 件と WebSocket の購読が済むのを待つ（購読の前に送られた通知は届かない）
async function openConversation(page: Page, id: number): Promise<void> {
  await page.goto(conversationUrl(id))
  await page.waitForFunction(listShown(50), null, { timeout: 30_000 })
  await page.waitForTimeout(2000)
}

// 600px 未満では、サイドバーを開いてから押す（画面設計書 2.19）
async function sidebarLink(page: Page, name: string) {
  const nav = page.getByRole('navigation', { name: '会話' })
  if (!(await nav.isVisible())) await page.getByRole('button', { name: 'サイドバーに戻る' }).click()
  return nav.getByRole('link', { name: new RegExp(`^${name}`) })
}

// 測るために送ったメッセージを消す（データを元に戻す）。添付は API が S3 からも消す
async function removeSent(page: Page, conversationId: number, prefix: string): Promise<void> {
  const res = await page.request.get(`/api/conversations/${conversationId}/messages`)
  const { items } = await res.json() as { items: { id: number, body: string }[] }
  const headers = await xsrfHeader(page.context())
  for (const m of items.filter((item) => item.body.includes(prefix))) {
    await page.request.delete(`/api/messages/${m.id}`, { headers })
  }
}

test('N-1 ログインしてワークスペースを選んでから、最新 50 件のメッセージが出るまで', async ({ browser }, info) => {
  const shown: number[] = []
  const imageTimes: number[] = []
  for (let i = 0; i < RUNS; i++) {
    // 毎回、Cookie もキャッシュもないブラウザで、ログイン画面から始める
    const context = await newContext(browser, info)
    const page = await context.newPage()
    await throttle(page, info)
    await fillLogin(page, 61)
    await page.getByRole('button', { name: 'ログイン' }).click()
    const link = page.getByRole('link', { name: /^性能テスト/ })
    await link.waitFor()
    const start = now()
    await link.click()
    await page.waitForFunction(listShown(50, 'general'), null, { polling: 'raf', timeout: 30_000 })
    shown.push(now() - start)
    // 画像（general の最新 50 件に 4 枚ずつ）は S3 から遅れて届くので、合否には入れず参考として記録する
    await page.waitForFunction(() => [...document.querySelectorAll('main article img')]
      // 一覧は一番下（最新）までスクロールしているので、上に隠れた画像（読み込みを遅らせる lazy）は除く
      .filter((img) => img.getBoundingClientRect().bottom > 0 && img.getBoundingClientRect().top < window.innerHeight)
      .every((img) => (img as HTMLImageElement).complete), null, { polling: 'raf', timeout: 60_000 })
    imageTimes.push(now() - start)
    await context.close()
  }
  const result = record(info, 'n1', 'N-1', 'ワークスペースを選ぶ → 最新 50 件', shown, { target: 3000 })
  record(info, 'n1-images', '参考', 'ワークスペースを選ぶ → 見えている画像まで', imageTimes)
  expect.soft(result.p95, `N-1 の P95（${result.samples.join(', ')}）`).toBeLessThanOrEqual(3000)
})

test('N-2 サイドバーで会話を切り替えてから、最新 50 件が出るまで', async ({ browser }, info) => {
  const page = await loggedIn(browser, info, 62)
  await openConversation(page, GENERAL)
  const shown: number[] = []
  for (let i = 0; i < RUNS; i++) {
    // perf-ch-11〜perf-ch-40 を順に開く（同じ会話を続けて開かない）
    const name = channelName(11 + (i % 30))
    const link = await sidebarLink(page, name)
    const start = now()
    await link.click()
    await page.waitForFunction(listShown(50, name), null, { polling: 'raf', timeout: 30_000 })
    shown.push(now() - start)
  }
  const result = record(info, 'n2', 'N-2', 'サイドバーで会話を切り替える → 最新 50 件', shown, { target: 1000 })
  expect.soft(result.p95, `N-2 の P95（${result.samples.join(', ')}）`).toBeLessThanOrEqual(1000)
})

test('N-3 メッセージを送ってから、同じ会話を開いている相手の画面に出るまで', async ({ browser }, info) => {
  const sender = await loggedIn(browser, info, 63)
  const receiver = await loggedIn(browser, info, 64)
  const id = channel(44)
  await openConversation(sender, id)
  await openConversation(receiver, id)
  const prefix = `N-3 の測定 ${info.project.name}`
  const shown: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const text = `${prefix} ${i} ${Date.now()}`
    const seen = await watchFor(receiver, messageShown(text))
    const input = sender.getByPlaceholder(`# ${channelName(44)} へのメッセージ`)
    await input.fill(text)
    const start = now()
    await input.press('Enter')
    shown.push(await seen() - start)
  }
  await removeSent(sender, id, prefix)
  const result = record(info, 'n3', 'N-3', '送る → 相手の画面に出る', shown, { target: 1000 })
  expect.soft(result.p95, `N-3 の P95（${result.samples.join(', ')}）`).toBeLessThanOrEqual(1000)
})

test('N-4 メッセージを送ってから、相手のサイドバーのメンションの件数が変わるまで', async ({ browser }, info) => {
  const sender = await loggedIn(browser, info, 63)
  const receiver = await loggedIn(browser, info, 64)
  // 送る先は perf-ch-43、相手は perf-ch-44 を開いている（perf-ch-43 は開いていないので、件数が出る）
  const to = channel(43)
  await openConversation(sender, to)
  await openConversation(receiver, channel(44))
  const badge = `nav[aria-label="会話"] a[href$="/c/${to}"] [aria-label^="メンション"]`
  const prefix = `N-4 の測定 ${info.project.name}`
  const shown: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const seen = await watchFor(receiver, `!!document.querySelector(${JSON.stringify(badge)})`)
    const input = sender.getByPlaceholder(`# ${channelName(43)} へのメッセージ`)
    await input.fill(`@${username(64)} ${prefix} ${i}`)
    const start = now()
    await input.press('Enter')
    shown.push(await seen() - start)
    // 読んだことにして件数を消してから、次を測る（測らない）
    const { items } = await (await receiver.request.get(`/api/conversations/${to}/messages`)).json() as { items: { id: number }[] }
    await receiver.request.post(`/api/conversations/${to}/read`,
      { headers: await xsrfHeader(receiver.context()), data: { lastMessageId: items.at(-1)!.id } })
    await receiver.waitForFunction(`!document.querySelector(${JSON.stringify(badge)})`, null, { timeout: 10_000 })
  }
  await removeSent(sender, to, prefix)
  const result = record(info, 'n4', 'N-4', '送る → 相手のサイドバーの件数', shown, { target: 1000 })
  expect.soft(result.p95, `N-4 の P95（${result.samples.join(', ')}）`).toBeLessThanOrEqual(1000)
})

// 検索の言葉（perf/seed.sql の本文）。3 文字以上の言葉は索引で探し、1〜2 文字の言葉は新しい順に読む（データ設計書 8.3）
const SEARCHES = [
  { key: 'rare', word: 'まれなさがしもの', label: '3 文字以上の言葉（まれ）' },
  { key: 'common2', word: '会議', label: '2 文字の言葉（よくある）' },
  { key: '1char', word: '旅', label: '1 文字の言葉' },
  { key: 'none2', word: 'ぬゑ', label: '見つからない 2 文字の言葉' },
]

// TC-13-9
test('N-5 検索してから、最初の 20 件が出るまで', async ({ browser }, info) => {
  const page = await loggedIn(browser, info, 62)
  for (const { key, word, label } of SEARCHES) {
    const shown: number[] = []
    for (let i = 0; i < RUNS; i++) {
      await openConversation(page, GENERAL)
      const open = page.getByRole('button', { name: 'メッセージを検索' })
      if (await open.isVisible()) await open.click()
      const box = page.getByRole('searchbox', { name: 'メッセージを検索' })
      await box.fill(word)
      const start = now()
      await box.press('Enter')
      await page.waitForFunction((w) => !!document.querySelector('main h1')?.textContent?.includes(`「${w}」の検索結果`)
        && (document.querySelectorAll('main li button').length > 0 || !!document.body.textContent?.includes('に一致するメッセージは見つかりませんでした')),
      word, { polling: 'raf', timeout: 30_000 })
      shown.push(now() - start)
    }
    const result = record(info, `n5-${key}`, 'N-5', `検索 → 最初の 20 件（${label}）`, shown, { target: 2000 })
    expect.soft(result.p95, `N-5 ${label} の P95（${result.samples.join(', ')}）`).toBeLessThanOrEqual(2000)
  }
})

// 送るファイル。画像は 10MB 弱（上限 10MB）の PNG を 4 枚、動画は 100MB 弱（上限 100MB）の MP4（ffmpeg で作る）
const FILES = new URL('../../perf/results/files/', import.meta.url)

function images(): string[] {
  mkdirSync(FILES, { recursive: true })
  return [1, 2, 3, 4].map((i) => {
    const file = new URL(`n6-${i}.png`, FILES)
    if (!existsSync(file)) writeFileSync(file, noisePng(1860, 1870))
    return file.pathname.replace(/^\/([A-Za-z]:)/, '$1')
  })
}

// 1280×720・30fps・約 13Mbps で 60 秒（約 98MB）。先頭に moov を置き、読み終わる前に再生できるようにする（faststart）
function video(): string | null {
  mkdirSync(FILES, { recursive: true })
  const file = new URL('n7.mp4', FILES)
  const path = file.pathname.replace(/^\/([A-Za-z]:)/, '$1')
  if (!existsSync(file)) {
    try {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '60',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '13M', '-minrate', '13M', '-maxrate', '13M', '-bufsize', '26M',
        '-x264-params', 'nal-hrd=cbr', '-movflags', '+faststart', path], { stdio: 'inherit' })
    } catch {
      return null
    }
  }
  expect(statSync(file).size, '動画は 100MB（104,857,600 バイト）以下').toBeLessThanOrEqual(104_857_600)
  return path
}

// 送る人がファイルを選んでアップロードし、送る。選んだ時刻を返す（アップロードの時間を含めて測るため）
async function attachAndSend(sender: Page, paths: string[], text: string): Promise<number> {
  const chooser = sender.waitForEvent('filechooser')
  await sender.getByRole('button', { name: 'ファイルを添付' }).click()
  const start = now()
  await (await chooser).setFiles(paths)
  await sender.getByPlaceholder(`# ${channelName(42)} へのメッセージ`).fill(text)
  const send = sender.getByRole('button', { name: '送信 ➤' })
  await expect(send).toBeEnabled({ timeout: 120_000 })
  await send.click()
  return start
}

// TC-09-7
test('N-6・N-7 画像 4 枚・動画 1 本を送ってから、相手の画面に出るまで', async ({ browser }, info) => {
  // 大きなファイルを S3 に送るので、PERF_UPLOAD=1 のとき（GitHub Actions のランナーの中の MinIO・公開先で測るとき）だけ測る。
  // 手元の開発用バケットは、画面の Vite（5173）からの PUT だけを受け付ける（CORS）ため、jar（8080）の画面からは送れない
  test.skip(process.env.PERF_UPLOAD !== '1', '添付の送信は PERF_UPLOAD=1 のときだけ測る')
  test.skip(UNDER_LOAD, '負荷をかけながらは測らない')
  test.skip(info.project.name !== 'pc', 'パソコンだけで測る')
  const sender = await loggedIn(browser, info, 63)
  const receiver = await loggedIn(browser, info, 64)
  const id = channel(42)
  await openConversation(sender, id)
  await openConversation(receiver, id)
  const prefix = 'N-6・N-7 の測定'

  const n6Times: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const text = `${prefix} 画像 ${i} ${Date.now()}`
    // 4 枚の縮小した画像が、読み込み終わって出るまで
    const seen = await watchFor(receiver, `[...document.querySelectorAll('main article')].some((a) => a.textContent.includes(${JSON.stringify(text)})
      && [...a.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth > 0).length === 4)`)
    const start = await attachAndSend(sender, images(), text)
    n6Times.push(await seen() - start)
    await removeSent(sender, id, prefix)
  }
  const n6 = record(info, 'n6', 'N-6', '画像 4 枚（40MB）を送る → 相手に縮小した画像', n6Times, { target: 15_000 })
  expect.soft(n6.p95, `N-6 の P95（${n6.samples.join(', ')}）`).toBeLessThanOrEqual(15_000)

  const path = video()
  test.skip(path === null, '動画を作る ffmpeg がない')
  const videoTimes: number[] = []
  const playTimes: number[] = []
  // 動画は 1 回に 100MB を送るので、回数を 1/4 にする（20 回なら 5 回）
  for (let i = 0; i < Math.max(1, Math.ceil(RUNS / 4)); i++) {
    const text = `${prefix} 動画 ${i} ${Date.now()}`
    // 再生ボタン（controls）が出るまで＝動画の情報（metadata）を読み込み終わるまで
    const seen = await watchFor(receiver, `[...document.querySelectorAll('main article')].some((a) => a.textContent.includes(${JSON.stringify(text)})
      && a.querySelector('video')?.readyState >= 1)`)
    const start = await attachAndSend(sender, [path!], text)
    videoTimes.push(await seen() - start)
    // 再生ボタンを押してから再生が始まるまで（全部を読み込むのを待たない）
    const played = await receiver.evaluate((t) => new Promise<number>((resolve, reject) => {
      const article = [...document.querySelectorAll('main article')].find((a) => a.textContent?.includes(t))
      const player = article?.querySelector('video')
      if (!player) return reject(new Error('動画がない'))
      player.muted = true
      const begin = performance.now()
      player.addEventListener('playing', () => resolve(performance.now() - begin), { once: true })
      void player.play()
    }), text)
    playTimes.push(played)
    await removeSent(sender, id, prefix)
  }
  const n7 = record(info, 'n7', 'N-7', '動画 1 本（100MB）を送る → 相手に再生ボタン', videoTimes, { target: 40_000 })
  const n7play = record(info, 'n7-play', 'N-7', '再生ボタンを押す → 再生が始まる', playTimes, { target: 5000 })
  expect.soft(n7.p95, `N-7 の P95（${n7.samples.join(', ')}）`).toBeLessThanOrEqual(40_000)
  expect.soft(n7play.p95, `N-7 の再生の P95（${n7play.samples.join(', ')}）`).toBeLessThanOrEqual(5000)
})
