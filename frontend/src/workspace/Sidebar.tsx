import { NavLink } from 'react-router'
import {
  channelsUrl, conversationUrl, dmUrl, invitesUrl, membersUrl, mentionsUrl, type ConversationSummary, type WorkspaceDetail,
} from '../api'
import Avatar from '../components/Avatar'
import CountBadge from '../components/CountBadge'
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

// G-5 のサイドバー（画面設計書 2.8）。未読の会話は太字にし（NT-1）、チャンネルはメンションの件数、DM は未読の件数を
// 丸で出す（NT-1・NT-2）。「メンション」にはワークスペースの読んでいないメンションの合計を出す
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
          {/* G-7（NT-5） */}
          <NavLink to={mentionsUrl(workspace.id)} onClick={onSelect} className={itemClass}>
            <span aria-hidden="true" className={styles.mark}>@</span>
            <span className={styles.name}>メンション</span>
            <CountBadge count={workspace.mentionCount} label="メンション" />
          </NavLink>
        </li>
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
              <CountBadge count={c.mentionCount} label="メンション" />
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
              <Avatar displayName={c.dmPartner.displayName} avatarUrl={c.dmPartner.avatarUrl} size={32} />
              <span className={styles.name}>
                {c.dmPartner.displayName}{c.dmPartner.statusEmoji ? ` ${c.dmPartner.statusEmoji}` : ''}
              </span>
              <CountBadge count={c.unreadCount} label="未読" />
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
