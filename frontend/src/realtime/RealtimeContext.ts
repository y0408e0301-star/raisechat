import { createContext, useContext } from 'react'
import type { ConnectionState, EventHandler } from './connection'

export type Realtime = {
  state: ConnectionState
  // 会話の通知を受け取る。返した関数で受け取るのをやめる（会話を移ったら前の会話の購読をやめる。機能定義書 4.2）
  subscribeConversation: (conversationId: number, handler: EventHandler) => () => void
  // つなぎ直せたときに呼ぶ。画面は届かなかった分を API で取り直す（4.4）
  onReconnect: (listener: () => void) => () => void
}

// RealtimeProvider の外（部品のテスト）では、つないでいないことにして何もしない
const none: Realtime = {
  state: 'idle',
  subscribeConversation: () => () => {},
  onReconnect: () => () => {},
}

export const RealtimeContext = createContext<Realtime>(none)

export function useRealtime(): Realtime {
  return useContext(RealtimeContext)
}
