import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, fetchMembers, kickMember, leaveWorkspace, type MemberView } from '../api'
import { useAuth } from '../auth/AuthContext'
import Avatar from '../components/Avatar'
import ConfirmDialog from '../components/ConfirmDialog'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M, M21, M23 } from '../messages'
import { MEMBER_SEARCH_MAX, limitChars } from '../validation'
import DeleteWorkspaceDialog from './DeleteWorkspaceDialog'
import styles from './MembersPage.module.css'
import { useWorkspace } from './WorkspaceContext'

// 入力が止まってから読み直すまで（画面設計書 11 章）
const DEBOUNCE_MS = 300

// いちばん下からこの距離まで来たら続きを読む
const LOAD_MORE_AT = 80

type Page = { items: MemberView[], nextCursor: string | null, memberCount: number }

// G-18 で確かめていること
type Confirming = { kind: 'kick', member: MemberView } | { kind: 'leave' } | { kind: 'delete' } | null

// G-9 メンバー一覧画面（MB-1・MB-3・MB-5・W-6、画面設計書 11 章）。
// 名前を押して G-16 を出すのは、プロフィール（開発計画書 1-10）で足す
export default function MembersPage() {
  const { workspace, showSidebar } = useWorkspace()
  const { me } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const owner = workspace.role === 'OWNER'
  const [query, setQuery] = useState('')
  // undefined：読み込み中、'failed'：読み込みに失敗
  const [page, setPage] = useState<Page | 'failed' | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [confirming, setConfirming] = useState<Confirming>(null)
  // 絞り込みを変えたら、前の絞り込みの結果が後から届いても使わない
  const latest = useRef(0)

  const load = useCallback(async (q: string) => {
    const ticket = ++latest.current
    try {
      const result = await fetchMembers(workspace.id, q.trim())
      if (ticket === latest.current) setPage(result)
    } catch {
      if (ticket === latest.current) setPage('failed')
    }
  }, [workspace.id])

  useEffect(() => {
    const timer = setTimeout(() => { void load(query) }, query ? DEBOUNCE_MS : 0)
    return () => clearTimeout(timer)
  }, [load, query])

  async function loadMore() {
    if (typeof page !== 'object' || !page.nextCursor || loadingMore) return
    const ticket = latest.current
    setLoadingMore(true)
    try {
      const more = await fetchMembers(workspace.id, query.trim(), page.nextCursor)
      if (ticket === latest.current) {
        setPage((current) => (typeof current === 'object'
          ? { ...more, items: [...current.items, ...more.items] }
          : current))
      }
    } catch {
      toast(M[48])
    } finally {
      setLoadingMore(false)
    }
  }

  function handleScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= LOAD_MORE_AT) void loadMore()
  }

  // キックしたら一覧から消す（MB-3）。もういなければ一覧を読み直す。
  // 失敗したときは ConfirmDialog が閉じて M-49 を出す
  async function kick(member: MemberView) {
    try {
      await kickMember(workspace.id, member.username)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) void load(query)
      throw e
    }
    setPage((current) => (typeof current === 'object'
      ? {
          ...current,
          items: current.items.filter((m) => m.username !== member.username),
          memberCount: current.memberCount - 1,
        }
      : current))
    setConfirming(null)
  }

  // 退出したら G-3 に移す（MB-5）
  async function leave() {
    await leaveWorkspace(workspace.id)
    navigate('/', { replace: true })
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <button type="button" className={styles.back} aria-label="サイドバーに戻る" onClick={showSidebar}>←</button>
        <h1 className={styles.title}>
          メンバー{typeof page === 'object' && `（${page.memberCount} 人）`}
        </h1>
      </div>
      <div className={styles.search}>
        <input type="search" className={styles.input} aria-label="名前で絞り込む" placeholder="🔍 名前で絞り込む"
          value={query} onChange={(e) => setQuery(limitChars(e.target.value, MEMBER_SEARCH_MAX))} />
      </div>
      <div className={styles.list} onScroll={handleScroll}>
        {page === 'failed' && (
          <div className={ui.empty}>
            <p>{M[48]}</p>
            <button type="button" className={ui.secondary} onClick={() => { setPage(undefined); void load(query) }}>
              再読み込み
            </button>
          </div>
        )}
        {typeof page === 'object' && page.items.length === 0 && <p className={ui.empty}>{M[47]}</p>}
        {typeof page === 'object' && (
          <ul className={styles.rows}>
            {page.items.map((m) => (
              <li key={m.username} className={styles.row}>
                <Avatar displayName={m.displayName} size={32} />
                <span className={styles.name}>{m.displayName}{m.statusEmoji ? ` ${m.statusEmoji}` : ''}</span>
                <span className={styles.username}>@{m.username}</span>
                {m.role === 'OWNER' && <span className={styles.badge}>オーナー</span>}
                {owner && m.username !== me?.username && m.role !== 'OWNER' && (
                  <button type="button" className={`${ui.danger} ${styles.kick}`} aria-label={`${m.displayName}をキック`}
                    onClick={() => setConfirming({ kind: 'kick', member: m })}>キック</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {loadingMore && <p className={styles.loading}>読み込み中…</p>}
      </div>
      <div className={styles.foot}>
        {owner
          ? <button type="button" className={styles.dangerOutline} onClick={() => setConfirming({ kind: 'delete' })}>ワークスペースを削除</button>
          : <button type="button" className={styles.dangerOutline} onClick={() => setConfirming({ kind: 'leave' })}>ワークスペースから退出</button>}
      </div>
      {confirming?.kind === 'kick' && (
        <ConfirmDialog title="メンバーのキック" message={M21(confirming.member.displayName)} action="キック"
          busy="キック中…" onConfirm={() => kick(confirming.member)} onClose={() => setConfirming(null)} />
      )}
      {confirming?.kind === 'leave' && (
        <ConfirmDialog title="ワークスペースから退出" message={M23(workspace.name)} action="退出" busy="退出中…"
          onConfirm={leave} onClose={() => setConfirming(null)} />
      )}
      {confirming?.kind === 'delete' && (
        <DeleteWorkspaceDialog workspace={workspace} onClose={() => setConfirming(null)}
          onDeleted={() => navigate('/', { replace: true })} />
      )}
    </div>
  )
}
