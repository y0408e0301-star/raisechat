import { MESSAGE_MAX, countChars } from '../validation'

// 送るときに数える文字数。前後の空白を取り除いて数える（画面設計書 2.18。API と同じ）
export function messageLength(value: string): number {
  return countChars(value.trim())
}

// 送れるか（MS-3・MS-4）。本文がない・4,000 文字を超えるときは送れない
export function isSendable(value: string): boolean {
  const length = messageLength(value)
  return length > 0 && length <= MESSAGE_MAX
}
