import { useSyncExternalStore } from 'react'
import { M } from '../messages'
import { useRealtime } from '../realtime/RealtimeContext'
import styles from './OfflineNotice.module.css'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const isOnline = () => navigator.onLine

// 接続が切れたときのお知らせ欄（画面設計書 2.4・2.20）。
// ブラウザがオフラインになったら M-50、WebSocket が切れてつなぎ直している間は M-37 と回転する印を出し、戻ったら消す。
// オフラインのときは M-37 の代わりに M-50 だけを出す
export default function OfflineNotice() {
  const online = useSyncExternalStore(subscribe, isOnline, () => true)
  const { state } = useRealtime()
  if (!online) return <div className={styles.notice} role="alert">{M[50]}</div>
  if (state === 'lost') {
    return (
      <div className={styles.notice} role="alert">
        {M[37]}
        <span className={styles.spinner} aria-hidden="true" />
      </div>
    )
  }
  return null
}
