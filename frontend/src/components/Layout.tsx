import { useState } from 'react'
import { Link, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import Avatar from './Avatar'
import styles from './Layout.module.css'
import OfflineNotice from './OfflineNotice'
import ui from './ui.module.css'

// G-3・G-10 の簡単なヘッダー（画面設計書 2.6）と、横幅 720px の 1 列（2.19）。
// 自分のアバターを押したときのメニューは、G-10 を作るプロフィール（開発計画書 1-10）で足す
export default function Layout() {
  const { me, signOut } = useAuth()
  const [sending, setSending] = useState(false)

  // 確認なしでログアウトし G-1 に移す（A-9）
  async function handleLogout() {
    setSending(true)
    await signOut()
  }

  return (
    <>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link to="/" className={styles.appName}>RaiseChat</Link>
          <div className={styles.right}>
            {me && (
              <span title={`${me.displayName}（@${me.username}）`} className={styles.me}>
                <Avatar displayName={me.displayName} size={32} />
              </span>
            )}
            <button type="button" className={ui.secondary} onClick={handleLogout} disabled={sending}>
              ログアウト
            </button>
          </div>
        </div>
        {/* お知らせ欄（M-50）。ヘッダーと一緒に画面の上に留める */}
        <OfflineNotice />
      </header>
      <main className={styles.container}>
        <Outlet />
      </main>
    </>
  )
}
