import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError, conversationUrl, fetchChannels, joinChannel, type ChannelListItem } from '../api'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M } from '../messages'
import { SEARCH_MAX, limitChars } from '../validation'
import styles from './ChannelsPage.module.css'
import { useWorkspace } from './WorkspaceContext'

// 入力が止まってから読み直すまで（画面設計書 10 章）
const DEBOUNCE_MS = 300

// いちばん下からこの距離まで来たら続きを読む
const LOAD_MORE_AT = 80

type Page = { items: ChannelListItem[], nextCursor: string | null }

// G-8 チャンネル一覧画面（CH-3・CH-4、画面設計書 10 章）。
// 公開チャンネルと、自分が入っているプライベートチャンネルを名前の順に出し、名前で絞り込む
export default function ChannelsPage() {
  const { workspace, showSidebar, openCreateChannel, upsertConversation } = useWorkspace()
  const toast = useToast()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  // undefined：読み込み中、'failed'：読み込みに失敗
  const [page, setPage] = useState<Page | 'failed' | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [joining, setJoining] = useState<number | null>(null)
  // 絞り込みを変えたら、前の絞り込みの結果が後から届いても使わない
  const latest = useRef(0)

  const load = useCallback(async (q: string) => {
    const ticket = ++latest.current
    try {
      const result = await fetchChannels(workspace.id, q.trim())
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
      const more = await fetchChannels(workspace.id, query.trim(), page.nextCursor)
      if (ticket === latest.current) {
        setPage((current) => (typeof current === 'object'
          ? { items: [...current.items, ...more.items], nextCursor: more.nextCursor }
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

  // 参加して G-5 で開く。サイドバーにも足す（CH-4）
  async function join(channel: ChannelListItem) {
    setJoining(channel.id)
    try {
      const joined = await joinChannel(channel.id)
      upsertConversation(joined)
      navigate(conversationUrl(workspace.id, channel.id))
    } catch (e) {
      setJoining(null)
      toast(e instanceof ApiError ? e.message : M[49])
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <button type="button" className={styles.back} aria-label="サイドバーに戻る" onClick={showSidebar}>←</button>
        <h1 className={styles.title}>チャンネルを探す</h1>
        <button type="button" className={ui.primary} onClick={openCreateChannel}>チャンネルを作る</button>
      </div>
      <div className={styles.search}>
        <input type="search" className={styles.input} aria-label="名前で絞り込む" placeholder="🔍 名前で絞り込む"
          value={query} onChange={(e) => setQuery(limitChars(e.target.value, SEARCH_MAX))} />
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
        {typeof page === 'object' && page.items.length === 0 && (
          <p className={ui.empty}>{query.trim() ? '一致するチャンネルはありません。' : 'チャンネルはありません。'}</p>
        )}
        {typeof page === 'object' && (
          <ul className={styles.rows}>
            {page.items.map((c) => (
              <li key={c.id} className={styles.row}>
                <div className={styles.main}>
                  {/* 名前を押すと、参加せずに G-5 で開く（CH-4） */}
                  <Link to={conversationUrl(workspace.id, c.id)} className={styles.name}>
                    <span aria-hidden="true">{c.visibility === 'PRIVATE' ? '🔒 ' : '# '}</span>{c.name}
                  </Link>
                  {c.description && <p className={styles.description}>{c.description}</p>}
                </div>
                {c.joined && <span className={styles.badge}>参加中</span>}
                <span className={styles.count} aria-label={`メンバー ${c.memberCount} 人`}>👥 {c.memberCount}</span>
                {!c.joined && c.visibility === 'PUBLIC' && (
                  <button type="button" className={ui.primary} onClick={() => join(c)} disabled={joining !== null}
                    aria-label={`${c.name}に参加する`}>
                    {joining === c.id ? '参加中…' : '参加する'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {loadingMore && <p className={styles.loading}>読み込み中…</p>}
      </div>
    </div>
  )
}
