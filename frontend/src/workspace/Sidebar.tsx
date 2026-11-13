import { NavLink } from 'react-router'
import {
  channelsUrl, conversationUrl, dmUrl, invitesUrl, membersUrl, type ConversationSummary, type WorkspaceDetail,
} from '../api'
import Avatar from '../components/Avatar'
import Menu from '../components/Menu'
import styles from './Sidebar.module.css'

type Props = {
  workspace: WorkspaceDetail
  conversations: ConversationSummary[]
  // 会話・G-8 を選んだとき（画面の横幅が 600px 未満では中身に切り替える）
  onSelect: () => void
  // 「チャンネル」の「＋」（G-13。CH-1）
  onCreateChannel: () => void
  // 「ダイレクトメッセージ」の「＋」（G-15。DM-2）
  onStartDm: () => void
}

const itemClass = ({ isActive }: { isActive: boolean }) => `${styles.item} ${isActive ? styles.active : ''}`

// G-5 のサイドバー（画面設計書 2.8）。
// 「メンション」と件数の丸は通知（開発計画書 1-15）で足す
export default function Sidebar({ workspace, conversations, onSelect, onCreateChannel, onStartDm }: Props) {
  const channels = conversations.filter((c) => c.type === 'CHANNEL')
  const dms = conversations.filter((c) => c.type === 'DM')
  // 「招待リンクの管理」はオーナーにだけ出す（MB-1・I-1・I-9）
  const menu = [
    { label: 'メンバー', to: membersUrl(workspace.id) },
    ...(workspace.role === 'OWNER' ? [{ label: '招待リンクの管理', to: invitesUrl(workspace.id) }] : []),
    { label: 'ワークスペースの一覧', to: '/' },
  ]
  return (
    <nav className={styles.sidebar} aria-label="会話">
      <Menu label={`${workspace.name}のメニュー`} buttonClassName={styles.workspace}
        items={menu} onSelect={onSelect}>
        <span className={styles.workspaceName}>{workspace.name}</span>
        <span aria-hidden="true">▾</span>
      </Menu>
      <ul className={`${styles.list} ${styles.links}`}>
        <li>
          {/* G-8（CH-3） */}
          <NavLink to={channelsUrl(workspace.id)} onClick={onSelect} className={itemClass}>
            <span aria-hidden="true" className={styles.mark}>🔍</span>
            <span className={styles.name}>チャンネルを探す</span>
          </NavLink>
        </li>
      </ul>
      <div className={styles.sectionHead}>
        <h2 className={styles.section}>チャンネル</h2>
        <button type="button" className={styles.add} aria-label="チャンネルを作る" title="チャンネルを作る"
          onClick={onCreateChannel}>＋</button>
      </div>
      <ul className={styles.list}>
        {channels.map((c) => (
          <li key={c.id}>
            <NavLink to={conversationUrl(workspace.id, c.id)} onClick={onSelect}
              className={({ isActive }) => `${itemClass({ isActive })} ${c.hasUnread ? styles.unread : ''}`}>
              <span aria-hidden="true" className={styles.mark}>{c.visibility === 'PRIVATE' ? '🔒' : '#'}</span>
              <span className={styles.name}>{c.name}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <div className={styles.sectionHead}>
        <h2 className={styles.section}>ダイレクトメッセージ</h2>
        <button type="button" className={styles.add} aria-label="ダイレクトメッセージを始める"
          title="ダイレクトメッセージを始める" onClick={onStartDm}>＋</button>
      </div>
      <ul className={styles.list}>
        {dms.map((c) => c.dmPartner && (
          <li key={c.id}>
            {/* 相手のアバター・表示名・ステータスの絵文字（2.8） */}
            <NavLink to={dmUrl(workspace.id, c.id)} onClick={onSelect}
              className={({ isActive }) => `${itemClass({ isActive })} ${c.hasUnread ? styles.unread : ''}`}>
              <Avatar displayName={c.dmPartner.displayName} size={32} />
              <span className={styles.name}>
                {c.dmPartner.displayName}{c.dmPartner.statusEmoji ? ` ${c.dmPartner.statusEmoji}` : ''}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
