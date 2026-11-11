import { NavLink } from 'react-router'
import { conversationUrl, type ConversationSummary, type WorkspaceDetail } from '../api'
import Menu from '../components/Menu'
import styles from './Sidebar.module.css'

type Props = {
  workspace: WorkspaceDetail
  conversations: ConversationSummary[]
  // 会話を選んだとき（画面の横幅が 600px 未満では会話に切り替える）
  onSelect: () => void
}

// G-5 のサイドバー（画面設計書 2.8）。
// 「メンション」と件数の丸は通知（開発計画書 1-15）、「チャンネルを探す」とチャンネルの「＋」はチャンネル（1-6）、
// 「ダイレクトメッセージ」は DM（1-9）、メニューの「メンバー」「招待リンクの管理」は 1-8・1-7 で足す
export default function Sidebar({ workspace, conversations, onSelect }: Props) {
  const channels = conversations.filter((c) => c.type === 'CHANNEL')
  return (
    <nav className={styles.sidebar} aria-label="会話">
      <Menu label={`${workspace.name}のメニュー`} buttonClassName={styles.workspace}
        items={[{ label: 'ワークスペースの一覧', to: '/' }]}>
        <span className={styles.workspaceName}>{workspace.name}</span>
        <span aria-hidden="true">▾</span>
      </Menu>
      <h2 className={styles.section}>チャンネル</h2>
      <ul className={styles.list}>
        {channels.map((c) => (
          <li key={c.id}>
            <NavLink to={conversationUrl(workspace.id, c.id)} onClick={onSelect}
              className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''} ${c.hasUnread ? styles.unread : ''}`}>
              <span aria-hidden="true" className={styles.mark}>{c.visibility === 'PRIVATE' ? '🔒' : '#'}</span>
              <span className={styles.name}>{c.name}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
