import { useSyncExternalStore } from 'react'
import { M } from '../messages'
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

// インターネットに接続できないときのお知らせ欄（画面設計書 2.4・2.20）。
// ブラウザがオフラインになったら M-50 を出し、接続が戻ったら消す。
// WebSocket が切れたときの M-37 は、リアルタイムの通知（開発計画書 1-5）で足す
export default function OfflineNotice() {
  const online = useSyncExternalStore(subscribe, isOnline, () => true)
  if (online) return null
  return <div className={styles.notice} role="alert">{M[50]}</div>
}
