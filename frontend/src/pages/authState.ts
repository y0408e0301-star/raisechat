import type { Location } from 'react-router'

// G-1・G-2 に渡す state
export type AuthPageState = {
  // ログインしていないときに開こうとした画面（A-10）。G-1 と G-2 を行き来しても渡し続ける
  from?: Location
  // 前の画面から渡されたメッセージ（M-8）
  message?: string
} | null

// ログイン・登録した後に移る先。開こうとした画面がなければ G-3
export function afterAuthPath(state: AuthPageState): string {
  const from = state?.from
  return from ? `${from.pathname}${from.search}${from.hash}` : '/'
}
