import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react'
import {
  ApiError, deleteChannel, fetchConversationMembers, fetchInviteCandidates, inviteToChannel, leaveChannel,
  type ConversationDetail, type UserSummary,
} from '../api'
import Avatar from '../components/Avatar'
import ConfirmDialog from '../components/ConfirmDialog'
import Dialog from '../components/Dialog'
import dialog from '../components/Dialog.module.css'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { formatFull } from '../dates'
import { M, M26, M29 } from '../messages'
import { SEARCH_MAX, limitChars } from '../validation'
import styles from './ChannelDialogs.module.css'

// 入力が止まってから探し直すまで
const DEBOUNCE_MS = 300

type Props = {
  channel: ConversationDetail
  // 見ている人がワークスペースのオーナーか（「チャンネルを削除」を出す）
  owner: boolean
  onClose: () => void
  // 招待した（メンバーの人数を足す）
  onInvited: (count: number) => void
  // 退出した・削除した。G-5 は general に移る（CH-8・CH-9）
  onLeft: () => void
  onDeleted: () => void
}

type Confirm = 'leave' | 'delete' | null

// G-14 チャンネルの詳細ダイアログ（CH-6〜CH-9、画面設計書 16 章）。
// メンバーの一覧と、「メンバーを招待」（プライベートのメンバー）・「チャンネルから退出」（general 以外のメンバー）・
// 「チャンネルを削除」（オーナー、general 以外）
export default function ChannelDetailsDialog({ channel, owner, onClose, onInvited, onLeft, onDeleted }: Props) {
  const toast = useToast()
  const [inviting, setInviting] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [leaving, setLeaving] = useState(false)
  const name = channel.name ?? ''
  const mark = channel.visibility === 'PRIVATE' ? '🔒' : '#'

  // 公開チャンネルは確認なしで退出する。プライベートは G-18 で確かめる（CH-8）
  async function leave() {
    if (channel.visibility === 'PRIVATE') {
      setConfirm('leave')
      return
    }
    setLeaving(true)
    try {
      await leaveChannel(channel.id)
      onLeft()
    } catch {
      setLeaving(false)
      toast(M[49])
    }
  }

  if (confirm === 'leave') {
    return (
      <ConfirmDialog title="チャンネルから退出" message={M29(name)} action="退出" busy="退出中…"
        onConfirm={async () => { await leaveChannel(channel.id); onLeft() }} onClose={() => setConfirm(null)} />
    )
  }
  if (confirm === 'delete') {
    return (
      <ConfirmDialog title="チャンネルの削除" message={M26(name)} action="削除" busy="削除中…"
        onConfirm={async () => { await deleteChannel(channel.id); onDeleted() }} onClose={() => setConfirm(null)} />
    )
  }
  if (inviting) {
    return (
      <InvitePanel channel={channel} onBack={() => setInviting(false)}
        onInvited={(count) => { setInviting(false); onInvited(count) }} />
    )
  }
  return (
    <Dialog title={`${mark} ${name}`} onClose={onClose}>
      {channel.description && <p className={styles.description}>{channel.description}</p>}
      <p className={styles.meta}>{channel.visibility === 'PRIVATE' ? 'プライベートチャンネル' : '公開チャンネル'}</p>
      <p className={styles.meta}>
        作成：{channel.createdBy.displayName}（@{channel.createdBy.username}）・{formatFull(channel.createdAt)}
      </p>
      <MemberList channel={channel}
        action={channel.visibility === 'PRIVATE' && channel.joined
          ? <button type="button" className={ui.primary} onClick={() => setInviting(true)}>メンバーを招待</button>
          : null} />
      {((channel.joined && !channel.general) || (owner && !channel.general)) && (
        <div className={styles.dangerActions}>
          {channel.joined && !channel.general && (
            <button type="button" className={`${ui.secondary} ${styles.dangerText}`} onClick={leave} disabled={leaving}>
              {leaving ? '退出中…' : 'チャンネルから退出'}
            </button>
          )}
          {owner && !channel.general && (
            <button type="button" className={`${ui.secondary} ${styles.dangerText}`} onClick={() => setConfirm('delete')}>
              チャンネルを削除
            </button>
          )}
        </div>
      )}
      <div className={dialog.actions}>
        <button type="button" className={ui.secondary} onClick={onClose} data-autofocus>閉じる</button>
      </div>
    </Dialog>
  )
}

// 2.17 ユーザーの行（アバター・表示名・@ユーザー ID）
function Person({ user }: { user: UserSummary }) {
  return (
    <>
      <Avatar displayName={user.displayName} size={32} />
      <span className={styles.personName}>{user.displayName}{user.statusEmoji ? ` ${user.statusEmoji}` : ''}</span>
      <span className={styles.username}>@{user.username}</span>
    </>
  )
}

// 入力が止まってから検索する文字
function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

type Members = { items: UserSummary[], nextCursor: string | null }

// メンバーの一覧（表示名の順。名前で絞り込み、下までスクロールしたら続きの 50 人を読む。CH-6）
function MemberList({ channel, action }: { channel: ConversationDetail, action: ReactNode }) {
  const [query, setQuery] = useState('')
  const q = useDebounced(query.trim())
  const [members, setMembers] = useState<Members | 'failed' | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const latest = useRef(0)

  // 絞り込みを変えたら最初から読む。前の絞り込みの結果・続きが後から届いても使わない
  useEffect(() => {
    const ticket = ++latest.current
    async function load() {
      try {
        const page = await fetchConversationMembers(channel.id, q)
        if (ticket === latest.current) setMembers(page)
      } catch {
        if (ticket === latest.current) setMembers('failed')
      }
    }
    void load()
  }, [channel.id, q])

  async function handleScroll(e: UIEvent<HTMLUListElement>) {
    const el = e.currentTarget
    if (typeof members !== 'object' || !members.nextCursor || loadingMore
      || el.scrollHeight - el.scrollTop - el.clientHeight > 40) return
    const ticket = latest.current
    setLoadingMore(true)
    try {
      const more = await fetchConversationMembers(channel.id, q, members.nextCursor)
      if (ticket === latest.current) {
        setMembers((current) => (typeof current === 'object'
          ? { items: [...current.items, ...more.items], nextCursor: more.nextCursor } : current))
      }
    } catch {
      // 続きは、次にスクロールしたときにもう一度読む
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section aria-label="メンバー">
      <div className={styles.membersHead}>
        <h3 className={styles.membersTitle}>メンバー（{channel.memberCount}）</h3>
        {action}
      </div>
      <input type="search" className={styles.input} aria-label="メンバーを名前で絞り込む" placeholder="名前で絞り込む"
        value={query} onChange={(e) => setQuery(limitChars(e.target.value, SEARCH_MAX))} />
      {members === 'failed' && <p className={styles.empty}>{M[48]}</p>}
      {typeof members === 'object' && members.items.length === 0 && <p className={styles.empty}>{M[47]}</p>}
      {typeof members === 'object' && members.items.length > 0 && (
        <ul className={styles.people} onScroll={handleScroll}>
          {members.items.map((u) => <li key={u.username} className={styles.person}><Person user={u} /></li>)}
        </ul>
      )}
      {loadingMore && <p className={styles.more}>読み込み中…</p>}
    </section>
  )
}

// 「招待する人を選ぶ」（CH-7）：そのチャンネルにいないワークスペースのメンバーを名前で探して選ぶ
function InvitePanel({ channel, onBack, onInvited }: {
  channel: ConversationDetail
  onBack: () => void
  onInvited: (count: number) => void
}) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const q = useDebounced(query.trim())
  const [candidates, setCandidates] = useState<UserSummary[] | 'failed' | undefined>(undefined)
  // 選んだ人（絞り込みを変えても残す）
  const [selected, setSelected] = useState<Map<string, UserSummary>>(new Map())
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const list = await fetchInviteCandidates(channel.id, q)
        if (active) setCandidates(list)
      } catch {
        if (active) setCandidates('failed')
      }
    }
    void load()
    return () => { active = false }
  }, [channel.id, q])

  function toggle(user: UserSummary) {
    setSelected((current) => {
      const next = new Map(current)
      if (next.has(user.username)) next.delete(user.username)
      else next.set(user.username, user)
      return next
    })
  }

  async function invite() {
    setSending(true)
    try {
      const added = await inviteToChannel(channel.id, [...selected.keys()])
      onInvited(added.length)
    } catch (e) {
      setSending(false)
      toast(M[49])
      // ワークスペースからいなくなった人がいた。候補を読み直す（FN-06 9 章）
      if (e instanceof ApiError && e.code === 'USER_NOT_FOUND') {
        setSelected(new Map())
        setCandidates(undefined)
        try {
          setCandidates(await fetchInviteCandidates(channel.id, q))
        } catch {
          setCandidates('failed')
        }
      }
    }
  }

  return (
    <Dialog title={`#${channel.name ?? ''} に招待する人を選ぶ`} onClose={onBack}>
      <input type="search" className={styles.input} aria-label="招待する人を名前で探す" placeholder="名前で探す"
        data-autofocus value={query} onChange={(e) => setQuery(limitChars(e.target.value, SEARCH_MAX))} />
      {candidates === 'failed' && <p className={styles.empty}>{M[48]}</p>}
      {Array.isArray(candidates) && candidates.length === 0 && <p className={styles.empty}>{M[47]}</p>}
      {Array.isArray(candidates) && candidates.length > 0 && (
        <ul className={styles.people}>
          {candidates.map((u) => (
            <li key={u.username}>
              <label className={styles.person}>
                <input type="checkbox" checked={selected.has(u.username)} onChange={() => toggle(u)}
                  aria-label={`${u.displayName}（@${u.username}）`} />
                <Person user={u} />
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className={dialog.actions}>
        <button type="button" className={ui.secondary} onClick={onBack}>戻る</button>
        <button type="button" className={ui.primary} onClick={invite} disabled={selected.size === 0 || sending}>
          {sending ? '招待中…' : `招待する（${selected.size}）`}
        </button>
      </div>
    </Dialog>
  )
}
