import { useCallback, useEffect, useState, type UIEvent } from 'react'
import { useNavigate } from 'react-router'
import { fetchMentions, messagePath, type MentionItem, type MentionPage } from '../api'
import Avatar from '../components/Avatar'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { formatFull, formatUntil } from '../dates'
import { M } from '../messages'
import { useRealtime } from '../realtime/RealtimeContext'
import styles from './MentionsPage.module.css'
import { useWorkspace } from './WorkspaceContext'

// いちばん下からこの距離まで来たら続きを読む
const LOAD_MORE_AT = 80

// G-7 メンション一覧画面（FN-14 NT-5、画面設計書 9 章）。自分あてのメンションを新しい順に 20 件ずつ出し、
// 読んでいないものに印を付ける。押すと G-5 でそのメッセージの位置を開く（MS-14）。
// 開いている間にチャンネルでメンションされたら、いちばん上に足す（NT-6）。
// 行は押せるボタンなので、本文は Markdown の飾りやメンションのボタンにせず、書いたままの文字で出す
export default function MentionsPage() {
  const { workspace, showSidebar } = useWorkspace()
  const toast = useToast()
  const navigate = useNavigate()
  const { subscribeUser } = useRealtime()
  // undefined：読み込み中、'failed'：読み込みに失敗
  const [page, setPage] = useState<MentionPage | 'failed' | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async () => {
    try {
      setPage(await fetchMentions(workspace.id))
    } catch {
      setPage('failed')
    }
  }, [workspace.id])

  useEffect(() => {
    let active = true
    fetchMentions(workspace.id).then((result) => active && setPage(result), () => active && setPage('failed'))
    return () => {
      active = false
    }
  }, [workspace.id])

  useEffect(() => subscribeUser((event) => {
    if (event.type !== 'notify' || event.workspaceId !== workspace.id || event.payload.kind !== 'MENTION') return
    const { message, conversationName } = event.payload
    const item: MentionItem = {
      message,
      conversation: { id: message.conversationId, type: 'CHANNEL', name: conversationName.replace(/^#/, ''), dmPartner: null },
      read: false,
    }
    setPage((current) => (typeof current === 'object' && !current.items.some((i) => i.message.id === message.id)
      ? { ...current, items: [item, ...current.items] }
      : current))
  }), [subscribeUser, workspace.id])

  async function loadMore() {
    if (typeof page !== 'object' || !page.nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const more = await fetchMentions(workspace.id, page.nextCursor)
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

  // そのメッセージの位置を開く。読んだことにするのは、G-5 が会話・スレッドを読んだときに API で行う（BR-15）
  function open(item: MentionItem) {
    setPage((current) => (typeof current === 'object'
      ? { ...current, items: current.items.map((i) => (i.message.id === item.message.id ? { ...i, read: true } : i)) }
      : current))
    navigate(messagePath({ workspaceId: workspace.id, id: item.conversation.id, type: item.conversation.type },
      item.message.id))
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <button type="button" className={styles.back} aria-label="サイドバーに戻る" onClick={showSidebar}>←</button>
        <h1 className={styles.title}>メンション</h1>
      </div>
      <div className={styles.list} onScroll={handleScroll}>
        {page === 'failed' && (
          <div className={ui.empty}>
            <p>{M[48]}</p>
            <button type="button" className={ui.secondary} onClick={() => { setPage(undefined); void load() }}>
              再読み込み
            </button>
          </div>
        )}
        {typeof page === 'object' && page.items.length === 0 && <p className={ui.empty}>{M[45]}</p>}
        {typeof page === 'object' && page.items.length > 0 && (
          <ul className={styles.rows}>
            {page.items.map((item) => {
              const { message, conversation } = item
              const where = conversation.type === 'DM'
                ? `${conversation.dmPartner?.displayName ?? ''}さんとの DM`
                : `# ${conversation.name ?? ''}`
              return (
                <li key={message.id}>
                  <button type="button" className={`${styles.row} ${item.read ? '' : styles.unread}`}
                    onClick={() => open(item)}>
                    {/* 読んでいない印は色の点だけでなく、読み上げでも「未読」と伝える（N-30） */}
                    <span className={styles.dot}>{!item.read && <span className={ui.visuallyHidden}>未読</span>}</span>
                    <Avatar displayName={message.author.displayName} avatarUrl={message.author.avatarUrl} size={36} />
                    <span className={styles.main}>
                      <span className={styles.meta}>
                        <span className={styles.where}>{where}</span>
                        <span className={styles.author}>{message.author.displayName}</span>
                        <time dateTime={message.createdAt} title={formatFull(message.createdAt)} className={styles.time}>
                          {formatUntil(message.createdAt)}
                        </time>
                      </span>
                      <span className={styles.body}>{message.body}</span>
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
