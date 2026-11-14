import { useEffect, useRef, useState, type UIEvent } from 'react'
import { ApiError, fetchMembers, startDm, type ConversationDetail, type MemberView } from '../api'
import { useAuth } from '../auth/AuthContext'
import Avatar from '../components/Avatar'
import Dialog from '../components/Dialog'
import dialog from '../components/Dialog.module.css'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M } from '../messages'
import { MEMBER_SEARCH_MAX, limitChars } from '../validation'
import styles from './ChannelDialogs.module.css'

// 入力が止まってから探すまで（画面設計書 17 章）
const DEBOUNCE_MS = 300

// いちばん下からこの距離まで来たら続きを読む
const LOAD_MORE_AT = 40

type Page = { items: MemberView[], nextCursor: string | null }

type Props = {
  workspaceId: number
  onClose: () => void
  // 開いた（なければ作った）DM
  onStarted: (dm: ConversationDetail) => void
}

// G-15 DM の相手の選択ダイアログ（DM-2、画面設計書 17 章）。
// 自分以外のワークスペースのメンバーを名前で探し（FN-05 のメンバーの一覧の API）、選ぶとその人との DM を開く。
// 一覧は 50 人ずつ読み、下までスクロールしたら続きを読む
export default function StartDmDialog({ workspaceId, onClose, onStarted }: Props) {
  const { me } = useAuth()
  const toast = useToast()
  const [query, setQuery] = useState('')
  // undefined：読み込み中、null：読み込みに失敗
  const [page, setPage] = useState<Page | null | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [starting, setStarting] = useState<string | null>(null)
  // 探す文字を変えたら、前の結果が後から届いても使わない
  const latest = useRef(0)

  useEffect(() => {
    const ticket = ++latest.current
    const timer = setTimeout(async () => {
      try {
        const first = await fetchMembers(workspaceId, query.trim())
        if (ticket === latest.current) setPage(first)
      } catch {
        if (ticket === latest.current) setPage(null)
      }
    }, query ? DEBOUNCE_MS : 0)
    return () => clearTimeout(timer)
  }, [workspaceId, query])

  async function loadMore() {
    if (!page?.nextCursor || loadingMore) return
    const ticket = latest.current
    setLoadingMore(true)
    try {
      const more = await fetchMembers(workspaceId, query.trim(), page.nextCursor)
      if (ticket === latest.current) {
        setPage((current) => (current ? { items: [...current.items, ...more.items], nextCursor: more.nextCursor } : current))
      }
    } catch {
      toast(M[48])
    } finally {
      setLoadingMore(false)
    }
  }

  function handleScroll(e: UIEvent<HTMLUListElement>) {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= LOAD_MORE_AT) void loadMore()
  }

  // 自分は選べないので出さない
  const members = page && page.items.filter((m) => m.username !== me?.username)

  async function choose(member: MemberView) {
    setStarting(member.username)
    try {
      onStarted(await startDm(workspaceId, member.username))
    } catch (e) {
      setStarting(null)
      toast(e instanceof ApiError ? e.message : M[49])
    }
  }

  return (
    <Dialog title="ダイレクトメッセージを始める" onClose={onClose}>
      <input type="search" className={styles.input} aria-label="名前で探す" placeholder="🔍 名前で探す" data-autofocus
        value={query} onChange={(e) => setQuery(limitChars(e.target.value, MEMBER_SEARCH_MAX))} />
      {members === null && <p className={styles.empty}>{M[48]}</p>}
      {members?.length === 0 && <p className={styles.empty}>{M[47]}</p>}
      {members && members.length > 0 && (
        <ul className={styles.people} onScroll={handleScroll}>
          {members.map((m) => (
            <li key={m.username}>
              {/* 2.17 ユーザーの行。右のボタンは出さず、行を押して選ぶ */}
              <button type="button" className={styles.pick} onClick={() => choose(m)} disabled={starting !== null}>
                <Avatar displayName={m.displayName} avatarUrl={m.avatarUrl} size={32} />
                <span className={styles.personName}>{m.displayName}{m.statusEmoji ? ` ${m.statusEmoji}` : ''}</span>
                <span className={styles.username}>@{m.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {loadingMore && <p className={styles.more}>読み込み中…</p>}
      <div className={dialog.actions}>
        <button type="button" className={ui.secondary} onClick={onClose}>キャンセル</button>
      </div>
    </Dialog>
  )
}
