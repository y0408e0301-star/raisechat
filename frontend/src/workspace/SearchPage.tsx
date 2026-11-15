import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  fetchChannels, fetchMembers, messagePath, searchMessages, searchUrl, type ChannelListItem, type MemberView,
  type SearchPage as Page, type SearchQuery, type SearchResult,
} from '../api'
import Avatar from '../components/Avatar'
import ui from '../components/ui.module.css'
import { formatDateTime } from '../dates'
import { M, M44 } from '../messages'
import styles from './SearchPage.module.css'
import { useWorkspace } from './WorkspaceContext'

// いちばん下からこの距離まで来たら続きを読む
const LOAD_MORE_AT = 80

// 送った人の候補を読むまで待つ時間
const MEMBER_DELAY_MS = 300

// 空白（半角・全角）で区切った言葉（API と同じ。FN-13 4 章）
const words = (q: string) => q.trim().split(/\s+/u).filter(Boolean).slice(0, 10)

// 本文の中の、検索した言葉に一致する所を目立たせる（SR-4。大文字・小文字を区別しない）
function highlight(text: string, terms: string[]): ReactNode[] {
  if (terms.length === 0) return [text]
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu')
  return text.split(pattern).map((part, i) => (i % 2 === 1 ? <mark key={i} className={styles.match}>{part}</mark> : part))
}

// URL（?q=&conversation=&from=）から検索の条件を読む（画面設計書 8 章）
function readQuery(params: URLSearchParams): SearchQuery {
  const conversation = Number(params.get('conversation'))
  return {
    q: (params.get('q') ?? '').trim(),
    conversationId: Number.isSafeInteger(conversation) && conversation > 0 ? conversation : null,
    from: params.get('from') || null,
  }
}

// G-6 検索結果画面（FN-13 SR-1〜SR-8、画面設計書 8 章）。見られる会話のメッセージを新しい順に 20 件ずつ出し、
// 会話と送った人で絞り込める。結果はリアルタイムでは変えない（SR-8）。
// 行は押せるボタンなので、本文は Markdown の飾りにせず、書いたままの文字で 3 行まで出し、一致した言葉を目立たせる
export default function SearchPage() {
  const { workspace, conversations, showSidebar } = useWorkspace()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const query = readQuery(params)
  const key = `${query.q}\n${query.conversationId ?? ''}\n${query.from ?? ''}`
  // 読んだ結果と、その条件（key）。条件を変えたら、前の条件の結果は出さない（読み込み中にする）
  const [loaded, setLoaded] = useState<{ key: string, page: Page | 'failed' } | null>(null)
  // undefined：読み込み中、'failed'：読み込みに失敗
  const page = loaded?.key === key ? loaded.page : undefined
  const setPage = useCallback((change: (current: Page) => Page | 'failed') => {
    setLoaded((current) => (current && typeof current.page === 'object' ? { ...current, page: change(current.page) } : current))
  }, [])
  const [loadingMore, setLoadingMore] = useState(false)
  // 条件を変えたら、前の条件の結果が後から届いても使わない
  const latest = useRef(0)

  const load = useCallback(async (target: SearchQuery, targetKey: string) => {
    const ticket = ++latest.current
    try {
      const result = await searchMessages(workspace.id, target)
      if (ticket === latest.current) setLoaded({ key: targetKey, page: result })
    } catch {
      if (ticket === latest.current) setLoaded({ key: targetKey, page: 'failed' })
    }
  }, [workspace.id])

  useEffect(() => {
    const [q, conversation, from] = key.split('\n')
    if (!q) return
    const ticket = ++latest.current
    searchMessages(workspace.id, { q, conversationId: conversation ? Number(conversation) : null, from: from || null })
      .then((result) => ticket === latest.current && setLoaded({ key, page: result }),
        () => ticket === latest.current && setLoaded({ key, page: 'failed' }))
  }, [key, workspace.id])

  async function loadMore() {
    if (typeof page !== 'object' || !page.nextCursor || loadingMore) return
    const ticket = latest.current
    setLoadingMore(true)
    try {
      const more = await searchMessages(workspace.id, query, page.nextCursor)
      if (ticket === latest.current) {
        setPage((current) => ({ items: [...current.items, ...more.items], nextCursor: more.nextCursor }))
      }
    } catch {
      setPage(() => 'failed')
    } finally {
      setLoadingMore(false)
    }
  }

  function handleScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= LOAD_MORE_AT) void loadMore()
  }

  // 絞り込みを変えたら URL を変えて読み直す（SR-5）
  function filter(change: Partial<SearchQuery>) {
    navigate(searchUrl(workspace.id, { ...query, ...change }), { replace: true })
  }

  // そのメッセージの位置を開く。スレッドの返信なら G-5 がスレッドのパネルも開く（SR-6）
  function open(result: SearchResult) {
    const c = result.conversation
    navigate(messagePath({ workspaceId: workspace.id, id: c.id, type: c.type }, result.message.id))
  }

  const terms = words(query.q)
  const dms = conversations.filter((c) => c.type === 'DM' && c.dmPartner)
    .toSorted((a, b) => (a.dmPartner?.displayName ?? '').localeCompare(b.dmPartner?.displayName ?? '', 'ja'))

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <button type="button" className={styles.back} aria-label="サイドバーに戻る" onClick={showSidebar}>←</button>
        <h1 className={styles.title}>「{query.q}」の検索結果</h1>
      </div>
      <div className={styles.filters}>
        <ConversationFilter workspaceId={workspace.id} dms={dms} value={query.conversationId}
          onChange={(conversationId) => filter({ conversationId })} />
        <SenderFilter workspaceId={workspace.id} value={query.from} onChange={(from) => filter({ from })} />
      </div>
      <div className={styles.list} onScroll={handleScroll}>
        {page === undefined && query.q && <p className={styles.loading}>読み込み中…</p>}
        {page === 'failed' && (
          <div className={ui.empty}>
            <p>{M[48]}</p>
            <button type="button" className={ui.secondary} onClick={() => {
              setLoaded(null)
              void load(query, key)
            }}>再読み込み</button>
          </div>
        )}
        {typeof page === 'object' && page.items.length === 0 && <p className={ui.empty}>{M44(query.q)}</p>}
        {typeof page === 'object' && page.items.length > 0 && (
          <ul className={styles.rows}>
            {page.items.map((result) => {
              const { message, conversation } = result
              const where = conversation.type === 'DM'
                ? `DM：${conversation.dmPartner?.displayName ?? ''}`
                : `# ${conversation.name ?? ''}`
              return (
                <li key={message.id}>
                  <button type="button" className={styles.row} onClick={() => open(result)}>
                    <span className={styles.meta}>
                      <span className={styles.where}>{where}</span>
                      {message.parentId !== null && <span className={styles.badge}>スレッドの返信</span>}
                    </span>
                    <span className={styles.message}>
                      <Avatar displayName={message.author.displayName} avatarUrl={message.author.avatarUrl} size={36} />
                      <span className={styles.main}>
                        <span className={styles.author}>
                          <span className={styles.name}>{message.author.displayName}</span>
                          <time dateTime={message.createdAt} className={styles.time}>{formatDateTime(message.createdAt)}</time>
                        </span>
                        <span className={styles.body}>{highlight(message.body, terms)}</span>
                        {message.attachments.length > 0 && (
                          <span className={styles.attachments} aria-label={`添付 ${message.attachments.length} 個`}>
                            📎 {message.attachments.length}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {loadingMore && <p className={styles.loading}>読み込み中…</p>}
      </div>
    </div>
  )
}

type ConversationFilterProps = {
  workspaceId: number
  dms: { id: number, dmPartner: { displayName: string } | null }[]
  value: number | null
  onChange: (conversationId: number | null) => void
}

// 「会話」の絞り込み：すべてと、自分が見られる会話（チャンネルは名前の順、DM は相手の表示名の順。画面設計書 8 章）
function ConversationFilter({ workspaceId, dms, value, onChange }: ConversationFilterProps) {
  const id = useId()
  const [channels, setChannels] = useState<ChannelListItem[]>([])

  useEffect(() => {
    let active = true
    async function loadAll() {
      const all: ChannelListItem[] = []
      let cursor: string | null = null
      do {
        const page = await fetchChannels(workspaceId, '', cursor)
        all.push(...page.items)
        cursor = page.nextCursor
      } while (cursor)
      if (active) setChannels(all)
    }
    loadAll().catch(() => {})
    return () => {
      active = false
    }
  }, [workspaceId])

  return (
    <label className={styles.filter} htmlFor={id}>
      <span>会話：</span>
      <select id={id} className={styles.select} value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">すべて</option>
        {channels.map((c) => <option key={c.id} value={c.id}>{`${c.visibility === 'PRIVATE' ? '🔒' : '#'} ${c.name}`}</option>)}
        {dms.map((c) => <option key={c.id} value={c.id}>{`DM：${c.dmPartner?.displayName ?? ''}`}</option>)}
      </select>
    </label>
  )
}

type SenderFilterProps = {
  workspaceId: number
  value: string | null
  onChange: (from: string | null) => void
}

// 「送った人」の絞り込み：名前を入れて、ワークスペースのメンバーから選ぶ（ユーザー ID を入れてもよい。抜けた人も探せる）
function SenderFilter({ workspaceId, value, onChange }: SenderFilterProps) {
  const id = useId()
  const listId = useId()
  const [text, setText] = useState(value ?? '')
  const [members, setMembers] = useState<MemberView[]>([])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      fetchMembers(workspaceId, text.replace(/^@/, '')).then((page) => active && setMembers(page.items), () => {})
    }, MEMBER_DELAY_MS)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [workspaceId, text])

  // 候補から選んだとき（ユーザー ID と同じになったとき）、Enter キー、欄から離れたときに絞り込む
  function apply(next: string) {
    const from = next.trim().replace(/^@/, '') || null
    if (from !== value) onChange(from)
  }

  return (
    <label className={styles.filter} htmlFor={id}>
      <span>送った人：</span>
      <input id={id} className={styles.sender} list={listId} placeholder="すべて" value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value === '' || members.some((m) => m.username === e.target.value)) apply(e.target.value)
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') apply(text) }} onBlur={() => apply(text)} />
      <datalist id={listId}>
        {members.map((m) => <option key={m.username} value={m.username}>{m.displayName}</option>)}
      </datalist>
    </label>
  )
}
