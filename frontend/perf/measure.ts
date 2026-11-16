import { mkdirSync, writeFileSync } from 'node:fs'
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'

// 画面の性能テスト（ui.spec.ts）で使う部品。回線・CPU の条件、ログイン、画面に出た時刻、測った値の集計と書き出し

// 結果を書き出す場所。frontend/perf/cli.ts が集めて表にする
export const UI_RESULTS_DIR = new URL('../../perf/results/ui/', import.meta.url)

// 1 つの項目を測る回数。20 回なら P95 は遅い方から 2 番目（基本設計書 2.4）
export const RUNS = Number(process.env.PERF_RUNS ?? 20)

// k6 で負荷をかけながら測っているか（npm run perf -- mixed）
export const UNDER_LOAD = process.env.PERF_UNDER_LOAD === '1'

// perf/seed.sql で入れたユーザー・ワークスペース・会話。k6 は 1〜51 番を使うので、画面の測定は 61〜64 番を使う
export const PASSWORD = 'perf-pass1'
export const username = (n: number) => `perf_${String(n).padStart(4, '0')}`
export const WORKSPACE = 900000001
export const GENERAL = 900000001
export const channel = (c: number) => 900000000 + c
export const channelName = (c: number) => `perf-ch-${String(c).padStart(2, '0')}`

// 測定の条件（要件定義書 11.1）：下り 10Mbps・上り 30Mbps・遅延 20ms。
// スマートフォン（project の mobile）は、CPU も 4 倍遅くする。Chromium（Edge）でしか使えない
export async function throttle(page: Page, info: TestInfo): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 20,
    downloadThroughput: 10_000_000 / 8,
    uploadThroughput: 30_000_000 / 8,
  })
  if (info.project.name === 'mobile') {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  }
}

// project の設定（baseURL・画面の幅など）で、Cookie もキャッシュもない新しいブラウザを開く
export async function newContext(browser: Browser, info: TestInfo): Promise<BrowserContext> {
  const { baseURL, viewport, locale, timezoneId, isMobile, hasTouch } = info.project.use
  return browser.newContext({ baseURL, viewport, locale, timezoneId, isMobile, hasTouch })
}

// G-1 からログインする。ボタンを押すところは呼んだ側で行う（N-1 は押してからの時間を測るため）
export async function fillLogin(page: Page, n: number): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('ユーザー ID').fill(username(n))
  await page.getByLabel('パスワード').fill(PASSWORD)
}

// 新しいブラウザでログインし、G-3 が出たページを返す
export async function loggedIn(browser: Browser, info: TestInfo, n: number): Promise<Page> {
  const page = await (await newContext(browser, info)).newPage()
  await throttle(page, info)
  await fillLogin(page, n)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await page.getByRole('heading', { name: 'ワークスペース', exact: true }).waitFor()
  return page
}

// GET 以外の API を画面の外から呼ぶときの CSRF のヘッダー（機能定義書 3.2）
export async function xsrfHeader(context: BrowserContext): Promise<Record<string, string>> {
  const token = (await context.cookies()).find((c) => c.name === 'XSRF-TOKEN')
  return token ? { 'X-XSRF-TOKEN': decodeURIComponent(token.value) } : {}
}

// いまの時刻（ミリ秒。Node とブラウザで同じ時計）
export const now = () => Date.now()

// ブラウザの中で、条件（ブラウザで動く関数の文字列）が成り立った時刻を待つ準備をする。
// 返した関数を await すると、その時刻（ミリ秒）になる。準備は、相手が操作する前に済ませる。
// 条件は、DOM が変わったときと、20ms ごとに確かめる（画像の読み込みが終わっても DOM は変わらないため）。
// timeout ミリ秒たっても成り立たなければ失敗にする
export async function watchFor(page: Page, condition: string, timeout = 120_000): Promise<() => Promise<number>> {
  const key = `perf${Math.random().toString(36).slice(2)}`
  await page.evaluate(({ name, source, limit }) => {
    const check = new Function(`return (${source})`) as () => boolean
    const store = window as unknown as Record<string, Promise<number>>
    store[name] = new Promise((resolve, reject) => {
      // 条件を書き間違えて例外になったときは、2 分待たずにすぐ失敗にする
      const done = () => {
        try {
          if (!check()) return false
        } catch (e) {
          reject(e)
          return true
        }
        resolve(performance.timeOrigin + performance.now())
        return true
      }
      if (done()) return
      const stop = () => {
        observer.disconnect()
        clearInterval(timer)
        clearTimeout(expiry)
      }
      const observer = new MutationObserver(() => {
        if (done()) stop()
      })
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
      const timer = setInterval(() => {
        if (done()) stop()
      }, 20)
      const expiry = setTimeout(() => {
        stop()
        reject(new Error(`${limit / 1000} 秒たっても画面に出ませんでした：${source}`))
      }, limit)
    })
    // 返した関数を await する前に失敗しても、ブラウザに「処理されていない失敗」として出さない（await したときに失敗が届く）
    store[name].catch(() => {})
  }, { name: key, source: condition, limit: timeout })
  return () => page.evaluate((k) => (window as unknown as Record<string, Promise<number>>)[k], key)
}

// 小さい順に並べて、p % の位置の値（nearest-rank 法）
export function percentile(samples: number[], p: number): number {
  const sorted = samples.toSorted((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

export type Result = {
  // 要件の ID（N-1 など）。目安として記録するだけの項目は「参考」
  id: string
  label: string
  project: string
  underLoad: boolean
  unit: string
  samples: number[]
  p50: number
  p95: number
  max: number
  // 目標（P95 で判定）。参考の項目にはない
  target?: number
  ok?: boolean
}

// 測った値を集計して、perf/results/ui/ に JSON で書き出す。合否は呼んだ側が expect.soft で確かめる
export function record(info: TestInfo, key: string, id: string, label: string, samples: number[],
  { target, unit = 'ms' }: { target?: number, unit?: string } = {}): Result {
  const p95 = percentile(samples, 95)
  const result: Result = {
    id, label, project: info.project.name, underLoad: UNDER_LOAD, unit, samples,
    p50: percentile(samples, 50), p95, max: Math.max(...samples),
    target, ok: target === undefined ? undefined : p95 <= target,
  }
  mkdirSync(UI_RESULTS_DIR, { recursive: true })
  const file = `${info.project.name}-${key}${UNDER_LOAD ? '-load' : ''}.json`
  writeFileSync(new URL(file, UI_RESULTS_DIR), JSON.stringify(result, null, 2))
  return result
}
