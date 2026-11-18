import { useSyncExternalStore } from 'react'
import type { MessageView } from '../api'

// ブラウザの通知（FN-14 NT-7〜NT-9）。設定はこのブラウザにだけ覚え、初めはオフ（データ要件定義書 9 章）
const STORAGE_KEY = 'raisechat.browserNotifications'

// 通知の本文の文字数（NT-7）
export const BODY_LENGTH = 50

const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

function write(on: boolean) {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, 'on')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 覚えられないブラウザでは、開いている間だけの設定になる
  }
  listeners.forEach((listener) => listener())
}

// このブラウザでブラウザの通知を使えるか（Notification がない・iOS の Safari など）
export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined'
}

// 設定がオンで、ブラウザも許可しているか
export function notificationsEnabled(): boolean {
  return read() && notificationsSupported() && Notification.permission === 'granted'
}

// G-10 のスイッチの状態。ほかの画面で変えても同じになるよう、変えたら知らせる
export function useNotificationSetting(): boolean {
  return useSyncExternalStore((onChange) => {
    listeners.add(onChange)
    return () => listeners.delete(onChange)
  }, notificationsEnabled)
}

// オンにする。まだ許可されていなければ許可を求める。許可されなかったとき・前に拒否していたときは false（M-46。NT-9）
export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission
  write(permission === 'granted')
  return permission === 'granted'
}

export function disableNotifications() {
  write(false)
}

// 通知を出す Service Worker（public/sw.js）。Android の Chrome は new Notification() を受け付けず、
// Service Worker の showNotification() でしか通知を出せないため（#71）
const WORKER_URL = '/sw.js'

// Service Worker を登録する。使えないブラウザ（Firefox のプライベートウィンドウなど）では何もしない（new Notification() で出す）
export function registerNotificationWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register(WORKER_URL).catch(() => {
    // 登録できなくても、new Notification() で出せるブラウザでは出る
  })
}

// 通知を出す（NT-7・NT-8）。Service Worker が動いていればそれで出し、押されたら Service Worker が
// アプリのタブを前に出して onNotificationOpen に path を渡す。動いていなければ new Notification() で出し、押されたら onOpen を呼ぶ
export function showNotification(title: string, options: { body: string, tag: string, path: string },
  onOpen: (path: string) => void) {
  const { body, tag, path } = options
  const fallback = () => {
    const notification = new Notification(title, { body, tag })
    notification.addEventListener('click', () => {
      window.focus()
      onOpen(path)
      notification.close()
    })
  }
  if (!('serviceWorker' in navigator)) {
    fallback()
    return
  }
  navigator.serviceWorker.getRegistration()
    .then((registration) => registration?.active
      ? registration.showNotification(title, { body, tag, data: { path } })
      : fallback())
    .catch(() => {
      // 出せなかった通知は捨てる（Android の Chrome で Service Worker がまだ動いていないときなど）。画面の中の件数は出る
    })
}

// Service Worker から、押された通知のメッセージの位置（path）を受け取る。返す関数で受け取りをやめる
export function onNotificationOpen(onOpen: (path: string) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {}
  const container = navigator.serviceWorker
  const listener = (event: MessageEvent) => {
    const { type, path } = (event.data ?? {}) as { type?: unknown, path?: unknown }
    // 画面の中の URL（/w/…）だけを開く
    if (type === 'open-message' && typeof path === 'string' && path.startsWith('/w/')) onOpen(path)
  }
  container.addEventListener('message', listener)
  // 読み込みの途中に届いたものも受け取る
  container.startMessages()
  return () => container.removeEventListener('message', listener)
}

// 通知の本文（NT-7、FN-14 5 章の 6）：Markdown 記法の記号を取り除き、改行を空白にして初めの 50 文字。
// 本文がなく添付だけのときは「画像・動画を送りました」
export function notificationBody(message: Pick<MessageView, 'body' | 'attachments'>): string {
  const text = message.body
    .replace(/^```.*$/gm, '')
    .replace(/^\s*(?:>\s?|[-*]\s+|\d+\.\s+)/gm, '')
    .replace(/[*~`]/g, '')
    // 「_」は斜体の記号のときだけ取り除く（「@taro_y」のように英数字にはさまれたものは残す）
    .replace(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return message.attachments.length > 0 ? '画像・動画を送りました' : ''
  const chars = Array.from(text)
  return chars.length > BODY_LENGTH ? chars.slice(0, BODY_LENGTH).join('') : text
}
