import { useState } from 'react'
import { Link } from 'react-router'
import { PROFILE_URL, mentionsUrl, workspaceUrl } from '../api'
import { useAuth } from '../auth/AuthContext'
import Avatar from './Avatar'
import CountBadge from './CountBadge'
import styles from './AppHeader.module.css'
import Menu from './Menu'
import SearchBox from './SearchBox'
import OfflineNotice from './OfflineNotice'
import ui from './ui.module.css'

// ヘッダーに出すワークスペースの名前は 20 文字まで。超えたら「…」で省く（画面設計書 2.6）
const WORKSPACE_NAME_SHOWN = 20

type Props = {
  // ワークスペース用のヘッダー（G-5〜G-9・G-11）のときに渡す。なければ簡単なヘッダー（G-3・G-10）
  workspace?: { id: number, name: string, mentionCount: number }
}

function shorten(name: string): string {
  const chars = Array.from(name)
  return chars.length > WORKSPACE_NAME_SHOWN ? `${chars.slice(0, WORKSPACE_NAME_SHOWN).join('')}…` : name
}

// ヘッダー（画面設計書 2.6）と、そのすぐ下のお知らせ欄（2.4）。
// ワークスペース用のヘッダーには、メッセージの検索欄（SR-1）と「@」と読んでいないメンションの件数（NT-2）を出す
export default function AppHeader({ workspace }: Props) {
  const { me, signOut } = useAuth()
  const [sending, setSending] = useState(false)

  // 確認なしでログアウトし G-1 に移す（A-9）
  async function handleLogout() {
    setSending(true)
    await signOut()
  }

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <Link to="/" className={`${styles.appName} ${workspace ? styles.hideNarrow : ''}`}>RaiseChat</Link>
          {workspace && (
            <>
              <span className={`${styles.separator} ${styles.hideNarrow}`} aria-hidden="true">▸</span>
              {/* 名前を押すと G-5（最後に開いた会話）。W-9 */}
              <Link to={workspaceUrl(workspace.id)} className={styles.workspaceName} title={workspace.name}>
                {shorten(workspace.name)}
              </Link>
            </>
          )}
        </div>
        {workspace && <SearchBox workspaceId={workspace.id} />}
        <div className={styles.right}>
          {workspace && (
            // G-7（NT-5）
            <Link to={mentionsUrl(workspace.id)} className={styles.mentions} title="メンション"
              aria-label={workspace.mentionCount > 0 ? `メンション ${workspace.mentionCount} 件` : 'メンション'}>
              <span aria-hidden="true">@</span>
              <CountBadge count={workspace.mentionCount} label="メンション" className={styles.mentionCount} />
            </Link>
          )}
          {me && (
            // 自分のアバターを押すとメニュー（W-5）
            <Menu label={`${me.displayName}（@${me.username}）のメニュー`} buttonClassName={styles.me} alignRight
              items={[{ label: 'プロフィールの設定', to: PROFILE_URL }, { label: 'ワークスペースの一覧', to: '/' }]}>
              <Avatar displayName={me.displayName} avatarUrl={me.avatarUrl} size={32} />
            </Menu>
          )}
          <button type="button" className={ui.secondary} onClick={handleLogout} disabled={sending}>
            ログアウト
          </button>
        </div>
      </div>
      {/* お知らせ欄（M-50）。ヘッダーと一緒に画面の上に留める */}
      <OfflineNotice />
    </header>
  )
}
