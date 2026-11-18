import { describe, expect, it, vi } from 'vitest'
import source from '../../public/sw.js?raw'

// ブラウザの通知を出す Service Worker（public/sw.js）の、通知を押したときの動き（FN-14 NT-8、#71）

type Listener = (event: { notification?: unknown, waitUntil: (p: Promise<unknown>) => void }) => void

// Service Worker の self の偽物で sw.js を動かし、notificationclick を起こす
async function click(tabs: { focus: () => Promise<unknown>, postMessage: (data: unknown) => void }[],
  path = '/w/3/c/10?message=7') {
  const listeners = new Map<string, Listener>()
  const self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => tabs), openWindow: vi.fn(async () => null) },
  }
  // oxlint-disable-next-line no-new-func -- 配る sw.js をそのまま、偽物の self の上で動かす
  new Function('self', source)(self)
  const notification = { close: vi.fn(), data: { path } }
  let done: Promise<unknown> = Promise.resolve()
  listeners.get('notificationclick')!({ notification, waitUntil: (p) => { done = p } })
  await done
  return { notification, openWindow: self.clients.openWindow }
}

describe('通知を押したとき（NT-8）', () => {
  it('アプリのタブを前に出し、そのメッセージの位置を開くよう知らせる', async () => {
    const tab = { focus: vi.fn(async () => {}), postMessage: vi.fn() }
    const { notification, openWindow } = await click([tab])
    expect(notification.close).toHaveBeenCalled()
    expect(tab.focus).toHaveBeenCalled()
    expect(tab.postMessage).toHaveBeenCalledWith({ type: 'open-message', path: '/w/3/c/10?message=7' })
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('アプリのタブがなければ、そのメッセージの位置を新しいタブで開く', async () => {
    const { openWindow } = await click([])
    expect(openWindow).toHaveBeenCalledWith('/w/3/c/10?message=7')
  })

  it('画面の中の URL（/w/…）でなければ、閉じるだけで何も開かない', async () => {
    const tab = { focus: vi.fn(async () => {}), postMessage: vi.fn() }
    const { notification, openWindow } = await click([tab], 'https://example.com/')
    expect(notification.close).toHaveBeenCalled()
    expect(tab.postMessage).not.toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
  })
})
