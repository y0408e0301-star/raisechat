import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import type { ConversationDetail, MessageView } from '../api'
import Avatar from '../components/Avatar'
import ui from '../components/ui.module.css'
import { dayKey, formatDayDivider } from '../dates'
import { entryKey, type Entry } from './entries'
import MessageItem from './MessageItem'
import styles from './MessageList.module.css'

// 同じ人が続けて送ったものをまとめる間隔（MS-12）
const GROUP_MS = 5 * 60 * 1000

// いちばん上からこの距離まで戻ったら、前を読み込む（MS-2）
const LOAD_OLDER_AT = 80

// いちばん下からこの距離までなら「いちばん下を見ている」とみなす（MS-5）
const AT_BOTTOM = 40

type Props = {
  conversation: ConversationDetail
  entries: Entry[]
  hasMoreBefore: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onDelete: (message: MessageView) => void
  onEdited: (message: MessageView) => void
  onGone: (messageId: number) => void
  onRetry: (clientId: string) => void
  onCancel: (clientId: string) => void
  // 添付が表示できなかった（署名付き URL の期限切れ。AT-10）
  onExpired: (messageId: number) => void
  // スレッドを開く（TH-1・TH-2）
  onOpenThread: (messageId: number) => void
}

function info(e: Entry) {
  return e.kind === 'sent'
    ? { username: e.message.author.username, createdAt: e.message.createdAt, deleted: e.message.deleted }
    : { username: e.author.username, createdAt: e.createdAt, deleted: false }
}

// 同じ人が 5 分以内に、同じ日に続けて送ったか（MS-12）
function continues(prev: Entry | undefined, current: Entry): boolean {
  if (!prev) return false
  const a = info(prev)
  const b = info(current)
  return a.username === b.username && !a.deleted && !b.deleted && dayKey(a.createdAt) === dayKey(b.createdAt)
    && Date.parse(b.createdAt) - Date.parse(a.createdAt) <= GROUP_MS
}

// G-5 の会話のメッセージの一覧（MS-1・MS-2・MS-12、画面設計書 2.9・7.1）。
// 開いたときと、自分が送ったときは、いちばん下を出す。前を読み込んだときは、見ていた位置を保つ。
// ほかの人のメッセージが届いたときは、いちばん下を見ていれば下まで送り、上の方を見ていれば送らずに
// 「新しいメッセージ」のボタンを出す（MS-5）。「新着」の線は通知（開発計画書 1-15）で足す
export default function MessageList({ conversation, entries, hasMoreBefore, loadingOlder, onLoadOlder, ...handlers }: Props) {
  const list = useRef<HTMLDivElement>(null)
  // 前を読み込む前の高さと位置
  const anchor = useRef<{ height: number, top: number } | null>(null)
  const lastKey = useRef<string | null>(null)
  // 最後にスクロールしたときに、いちばん下を見ていたか（中身が増える前の位置で決める）
  const atBottom = useRef(true)
  const [newArrived, setNewArrived] = useState(false)

  const last = entries.at(-1)
  const currentLastKey = last ? entryKey(last) : null
  // いちばん下に足されたのが、ほかの人のメッセージか
  const fromOthers = last?.kind === 'sent' && !last.message.mine

  const firstKey = entries[0] ? entryKey(entries[0]) : null

  // 前を読み込んで上に足したら（先頭が変わったら）、見ていた位置を保つ
  useLayoutEffect(() => {
    const el = list.current
    if (!el || !anchor.current || firstKey === null) return
    el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top
    anchor.current = null
  }, [firstKey])

  // いちばん下に足されたとき
  useLayoutEffect(() => {
    const el = list.current
    if (!el || currentLastKey === lastKey.current) return
    if (lastKey.current === null || atBottom.current || !fromOthers) {
      el.scrollTop = el.scrollHeight
      atBottom.current = true
    } else {
      setNewArrived(true)
    }
    lastKey.current = currentLastKey
  }, [currentLastKey, fromOthers])

  function scrollToBottom() {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
    atBottom.current = true
    setNewArrived(false)
  }

  function handleScroll() {
    const el = list.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM
    if (atBottom.current && newArrived) setNewArrived(false)
    if (!hasMoreBefore || loadingOlder || el.scrollTop > LOAD_OLDER_AT) return
    anchor.current = { height: el.scrollHeight, top: el.scrollTop }
    onLoadOlder()
  }

  return (
    <div className={styles.wrap}>
      <div ref={list} className={styles.list} onScroll={handleScroll}>
        {loadingOlder && <p className={styles.loading}>読み込み中…</p>}
        {!hasMoreBefore && (conversation.dmPartner
          ? (
            // 会話の始まり（DM。相手のアバター・表示名。画面設計書 2.9）
            <div className={styles.start}>
              <Avatar displayName={conversation.dmPartner.displayName} avatarUrl={conversation.dmPartner.avatarUrl} size={96} />
              <h2 className={styles.startTitle}>{conversation.dmPartner.displayName}</h2>
              <p className={styles.startText}>
                {conversation.dmPartner.displayName}さんとのダイレクトメッセージはここから始まります。
              </p>
            </div>
          )
          : (
            // 会話の始まり（MS-2）
            <div className={styles.start}>
              <h2 className={styles.startTitle}>
                <span aria-hidden="true">{conversation.visibility === 'PRIVATE' ? '🔒 ' : '# '}</span>{conversation.name}
              </h2>
              <p className={styles.startText}>このチャンネルはここから始まります。</p>
              {conversation.description && <p className={styles.startText}>{conversation.description}</p>}
            </div>
          ))}
        {entries.map((entry, i) => {
          const prev = entries[i - 1]
          const createdAt = info(entry).createdAt
          const newDay = !prev || dayKey(info(prev).createdAt) !== dayKey(createdAt)
          return (
            <Fragment key={entryKey(entry)}>
              {newDay && (
                // 日付の区切り（MS-12）
                <div className={styles.divider}>
                  <span>{formatDayDivider(createdAt)}</span>
                </div>
              )}
              <MessageItem entry={entry} compact={!newDay && continues(prev, entry)} canPost={conversation.canPost}
                {...handlers} />
            </Fragment>
          )
        })}
      </div>
      {newArrived && (
        // 入力欄のすぐ上の中央（画面設計書 7.1）
        <button type="button" className={`${ui.primary} ${styles.newArrived}`} onClick={scrollToBottom}>
          ↓ 新しいメッセージ
        </button>
      )}
    </div>
  )
}
