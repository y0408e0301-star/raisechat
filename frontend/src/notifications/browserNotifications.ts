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
