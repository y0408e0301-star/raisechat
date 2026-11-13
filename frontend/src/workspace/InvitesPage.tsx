import { useCallback, useEffect, useState, type UIEvent } from 'react'
import { Navigate } from 'react-router'
import {
  ApiError, createInvite, fetchInvites, revokeInvite, workspaceUrl, type InviteView,
} from '../api'
import ConfirmDialog from '../components/ConfirmDialog'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { formatDateTime } from '../dates'
import { M } from '../messages'
import styles from './InvitesPage.module.css'
import { useWorkspace } from './WorkspaceContext'

// いちばん下からこの距離まで来たら続きを読む
const LOAD_MORE_AT = 80

// URL がこの文字数を超えたら、真ん中を「…」で省く（画面設計書 13 章）
const URL_SHOWN = 40

type Page = { items: InviteView[], nextCursor: string | null }

const STATUS_LABEL: Record<InviteView['status'], string> = { ACTIVE: '有効', EXPIRED: '期限切れ', REVOKED: '取り消し済み' }

function shortUrl(url: string): string {
  if (url.length <= URL_SHOWN) return url
  return `${url.slice(0, URL_SHOWN - 9)}…${url.slice(-8)}`
}

// G-11 招待リンクの管理画面（I-1〜I-3・I-9、画面設計書 13 章）。オーナーだけが開ける
export default function InvitesPage() {
  const { workspace } = useWorkspace()
  // オーナーでない人が URL を開いたときは G-5 に移す（I-9）
  if (workspace.role !== 'OWNER') return <Navigate to={workspaceUrl(workspace.id)} replace />
  return <OwnerInvites workspaceId={workspace.id} />
}

function OwnerInvites({ workspaceId }: { workspaceId: number }) {
  const { showSidebar } = useWorkspace()
  const toast = useToast()
  // undefined：読み込み中、'failed'：読み込みに失敗
  const [page, setPage] = useState<Page | 'failed' | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<InviteView | null>(null)

  const load = useCallback(async (): Promise<Page | 'failed'> => {
    try {
      return await fetchInvites(workspaceId)
    } catch {
      return 'failed'
    }
  }, [workspaceId])

  useEffect(() => {
    let active = true
    async function first() {
      const result = await load()
      if (active) setPage(result)
    }
    void first()
    return () => {
      active = false
    }
  }, [load])

  async function reload() {
    setPage(undefined)
    setPage(await load())
  }

  async function loadMore() {
    if (typeof page !== 'object' || !page.nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const more = await fetchInvites(workspaceId, page.nextCursor)
      setPage((current) => (typeof current === 'object'
        ? { items: [...current.items, ...more.items], nextCursor: more.nextCursor }
        : current))
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

  // 作ったリンクを一覧の先頭に出す（I-2）
  async function create() {
    setCreating(true)
    try {
      const created = await createInvite(workspaceId)
      setPage((current) => (typeof current === 'object' ? { ...current, items: [created, ...current.items] } : current))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : M[49])
    } finally {
      setCreating(false)
    }
  }

  async function copy(invite: InviteView) {
    try {
      await navigator.clipboard.writeText(invite.url)
      toast(M[20])
    } catch {
      toast(M[49])
    }
  }

  // 取り消したら、その行を「取り消し済み」にする（I-3）。もうなければ一覧を読み直す。
  // 失敗したときは ConfirmDialog が閉じて M-49 を出す
  async function revoke(invite: InviteView) {
    try {
      await revokeInvite(workspaceId, invite.id)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) void reload()
      throw e
    }
    const revokedAt = new Date().toISOString()
    setPage((current) => (typeof current === 'object'
      ? {
          ...current,
          items: current.items.map((i) => (i.id === invite.id ? { ...i, status: 'REVOKED' as const, revokedAt } : i)),
        }
      : current))
    setRevoking(null)
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <button type="button" className={styles.back} aria-label="サイドバーに戻る" onClick={showSidebar}>←</button>
        <h1 className={styles.title}>招待リンク</h1>
        <button type="button" className={ui.primary} onClick={create} disabled={creating}>
          {creating ? '作成中…' : '招待リンクを作る'}
        </button>
      </div>
      <p className={styles.note}>リンクは作ってから 7 日間使えます。何人でも参加できます。</p>
      <div className={styles.list} onScroll={handleScroll}>
        {page === 'failed' && (
          <div className={ui.empty}>
            <p>{M[48]}</p>
            <button type="button" className={ui.secondary} onClick={reload}>
              再読み込み
            </button>
          </div>
        )}
        {typeof page === 'object' && page.items.length === 0 && (
          <p className={ui.empty}>招待リンクはありません。</p>
        )}
        {typeof page === 'object' && (
          <ul className={styles.rows}>
            {page.items.map((invite) => {
              const active = invite.status === 'ACTIVE'
              return (
                <li key={invite.id} className={`${styles.row} ${active ? '' : styles.inactive}`}>
                  <div className={styles.main}>
                    <p className={styles.line}>
                      <span className={styles.url} title={invite.url}>{shortUrl(invite.url)}</span>
                      <span className={styles.status}>{STATUS_LABEL[invite.status]}</span>
                      {active && <span>{formatDateTime(invite.expiresAt)} まで</span>}
                    </p>
                    <p className={styles.created}>{formatDateTime(invite.createdAt)} に作成</p>
                  </div>
                  {active && (
                    <div className={styles.actions}>
                      <button type="button" className={ui.secondary} onClick={() => copy(invite)}>コピー</button>
                      <button type="button" className={`${ui.secondary} ${styles.dangerText}`}
                        onClick={() => setRevoking(invite)}>取り消す</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {loadingMore && <p className={styles.loading}>読み込み中…</p>}
      </div>
      {revoking && (
        <ConfirmDialog title="招待リンクの取り消し" message={M[17]} action="取り消す" busy="取り消し中…"
          onConfirm={() => revoke(revoking)} onClose={() => setRevoking(null)} />
      )}
    </div>
  )
}
