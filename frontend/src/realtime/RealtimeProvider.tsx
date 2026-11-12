import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { checkSession } from '../api'
import { useAuth } from '../auth/AuthContext'
import { RealtimeConnection } from './connection'
import { RealtimeContext, type Realtime } from './RealtimeContext'

// ログインしている間だけ WebSocket をつなぎ、ログアウトしたら切る（機能定義書 4.1）
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth()
  const signedIn = Boolean(me)
  const [connection] = useState(() => new RealtimeConnection({ checkSession }))
  const state = useSyncExternalStore(connection.subscribeState, connection.getState)

  useEffect(() => {
    if (!signedIn) return
    connection.start()
    return () => connection.stop()
  }, [connection, signedIn])

  const realtime = useMemo<Realtime>(() => ({
    state,
    subscribeConversation: connection.subscribeConversation,
    onReconnect: connection.onReconnect,
  }), [connection, state])
  return <RealtimeContext value={realtime}>{children}</RealtimeContext>
}
