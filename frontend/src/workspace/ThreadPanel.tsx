import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ApiError, fetchReplies, sendReply, type AttachmentView, type ConversationDetail, type MessageView, type ReactionView,
} from '../api'
import { useUploads } from '../attachments/uploads'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M, M36 } from '../messages'
import type { RealtimeEvent } from '../realtime/events'
import { useRealtime } from '../realtime/RealtimeContext'
import Composer from './Composer'
import DeleteMessageDialog from './DeleteMessageDialog'
import type { Entry } from './entries'
import { addMessage, forViewer, replaceReactions, settlePending, type Viewer } from './liveMessages'
import MessageItem from './MessageItem'
import styles from './ThreadPanel.module.css'

type Props = {
  conversation: ConversationDetail
  // 親メッセージの ID（URL の ?thread=）
  parentId: number
  viewer: Viewer
  onClose: () => void
}

type Loaded = { parent: MessageView, items: MessageView[], hasMoreBefore: boolean }

type Pending = Extract<Entry, { kind: 'pending' }>

// 上の端からこの距離まで来たら、前の返信を読む（FN-08 5 章の 5）
const LOAD_OLDER_AT = 80

// いちばん下からこの距離までなら「いちばん下を見ている」とみなす（会話の一覧と同じ。MS-5）
const AT_BOTTOM = 40

// スレッドのパネル（画面設計書 7.2、TH-1〜TH-8）。親メッセージ・返信の一覧（古いものが上）・返信の入力欄。
// 購読は会話の /topic/conversations/{id} だけで、返信と親の変化の通知もそこに届く（FN-08 5 章の 4）
export default function ThreadPanel({ conversation, parentId, viewer, onClose }: Props) {
  const toast = useToast()
  const { subscribeConversation, onReconnect } = useRealtime()
  // undefined：読み込み中、'failed'：読み込みに失敗
  const [loaded, setLoaded] = useState<Loaded | 'failed' | undefined>(undefined)
  const [pending, setPending] = useState<Pending[]>([])
  const [draft, setDraft] = useState('')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [deleting, setDeleting] = useState<MessageView | null>(null)
  const uploads = useUploads(conversation.id, toast)
  const list = useRef<HTMLDivElement>(null)
  // 前を読み込む前の高さと位置（読み込んだ後も、見ていた返信を同じ場所に出す）
  const anchor = useRef<{ height: number, top: number } | null>(null)
  // 次に描いたときに、いちばん下を出す（開いたとき・自分が送ったとき）
  const toBottom = useRef(true)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])

  const load = useCallback(async (): Promise<Loaded | 'failed' | 'gone'> => {
    try {
      const page = await fetchReplies(parentId)
      return { parent: forViewer(page.parent, viewer), items: page.items.map((m) => forViewer(m, viewer)),
        hasMoreBefore: page.hasMoreBefore }
    } catch (e) {
      return e instanceof ApiError && e.status === 404 ? 'gone' : 'failed'
    }
  }, [parentId, viewer])

  // 親メッセージがもうない（消された・見られない）ときは、M-49 を出してパネルを閉じる（FN-08 9 章）
  const show = useCallback((result: Loaded | 'failed' | 'gone') => {
    if (result === 'gone') {
      toast(M[49])
      close.current()
      return
    }
    toBottom.current = true
    setLoaded(result)
  }, [toast])

  useEffect(() => {
    let active = true
    load().then((result) => active && show(result), () => {})
    return () => {
      active = false
    }
  }, [load, show])

  // つなぎ直したら、切れていた間の取りこぼしをなくすため読み直す（機能定義書 4.4）
  useEffect(() => onReconnect(async () => {
    const result = await load()
    if (result !== 'failed') show(result)
  }), [onReconnect, load, show])

  const update = useCallback((change: (current: Loaded) => Loaded) => {
    setLoaded((current) => (typeof current === 'object' ? change(current) : current))
  }, [])

  // 返信が届いたらパネルに足し、親の件数・本文の変化を反映する。親が消えたらパネルを閉じる（TH-3・TH-7）
  useEffect(() => subscribeConversation(conversation.id, (event: RealtimeEvent) => {
    if (event.conversationId !== conversation.id) return
    if (event.type === 'message.created' && event.payload.parentId === parentId) {
      const created = forViewer(event.payload, viewer)
      // いちばん下を見ていれば、届いた返信が見えるよう下まで送る
      const el = list.current
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM) toBottom.current = true
      setPending((items) => settlePending(items, event, viewer))
      update((current) => ({ ...current, items: addMessage(current.items, created) }))
    } else if (event.type === 'message.updated') {
      const updated = event.payload
      if (updated.id === parentId) update((current) => ({ ...current, parent: forViewer(updated, viewer, current.parent) }))
      else if (updated.parentId === parentId) {
        update((current) => ({
          ...current, items: current.items.map((m) => (m.id === updated.id ? forViewer(updated, viewer, m) : m)),
        }))
      }
    } else if (event.type === 'reaction.updated') {
      const { messageId, reactions } = event.payload
      update((current) => ({
        ...current,
        parent: current.parent.id === messageId ? replaceReactions(current.parent, reactions, viewer) : current.parent,
        items: current.items.map((m) => (m.id === messageId ? replaceReactions(m, reactions, viewer) : m)),
      }))
    } else if (event.type === 'message.deleted') {
      if (event.payload.id === parentId) close.current()
      else if (event.payload.parentId === parentId) {
        update((current) => ({ ...current, items: current.items.filter((m) => m.id !== event.payload.id) }))
      }
    }
  }), [subscribeConversation, conversation.id, parentId, viewer, update])

  // 開いたとき・自分が送ったときはいちばん下を、前を読み込んだときは見ていた位置を出す。
  // どちらも ref に印を付けておき、描いた後に（毎回）確かめる
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    if (anchor.current) {
      el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top
      anchor.current = null
    } else if (toBottom.current) {
      el.scrollTop = el.scrollHeight
      toBottom.current = false
    }
  })

  async function loadOlder() {
    if (typeof loaded !== 'object' || loadingOlder || !loaded.hasMoreBefore || loaded.items.length === 0) return
    const el = list.current
    if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop }
    setLoadingOlder(true)
    try {
      const page = await fetchReplies(parentId, loaded.items[0].id)
      update((current) => ({
        ...current, items: [...page.items.map((m) => forViewer(m, viewer)), ...current.items],
        hasMoreBefore: page.hasMoreBefore,
      }))
    } catch {
      anchor.current = null
      toast(M[48])
    } finally {
      setLoadingOlder(false)
    }
  }

  function handleScroll() {
    if ((list.current?.scrollTop ?? Infinity) <= LOAD_OLDER_AT) void loadOlder()
  }

  // 返信を送る。送り方・失敗したときの扱いは会話への送信と同じ（TH-3、FN-07 MS-3・MS-13）
  const post = useCallback(async (clientId: string, body: string, attachments: AttachmentView[]) => {
    try {
      const sent = await sendReply(parentId, body, clientId, attachments.map((a) => a.id))
      setPending((items) => items.filter((p) => p.clientId !== clientId))
      update((current) => ({ ...current, items: addMessage(current.items, sent) }))
    } catch {
      setPending((items) => items.map((p) => (p.clientId === clientId ? { ...p, failed: true } : p)))
    }
  }, [parentId, update])

  function send(body: string, attachments: AttachmentView[]) {
    const clientId = crypto.randomUUID()
    toBottom.current = true
    setPending((items) => [...items, {
      kind: 'pending', clientId, author: viewer.me, body, attachments, createdAt: new Date().toISOString(), failed: false,
    }])
    setDraft('')
    void post(clientId, body, attachments)
  }

  function retry(clientId: string) {
    const target = pending.find((p) => p.clientId === clientId)
    if (!target) return
    setPending((items) => items.map((p) => (p.clientId === clientId ? { ...p, failed: false } : p)))
    void post(clientId, target.body, target.attachments)
  }

  function cancel(clientId: string) {
    const target = pending.find((p) => p.clientId === clientId)
    if (!target) return
    setPending((items) => items.filter((p) => p.clientId !== clientId))
    setDraft((current) => (current ? `${target.body}\n${current}` : target.body))
    uploads.restore(target.attachments)
  }

  function replace(message: MessageView) {
    update((current) => (message.id === parentId
      ? { ...current, parent: message }
      : { ...current, items: current.items.map((m) => (m.id === message.id ? message : m)) }))
  }

  function remove(messageId: number) {
    if (messageId === parentId) {
      onClose()
      return
    }
    update((current) => ({ ...current, items: current.items.filter((m) => m.id !== messageId) }))
  }

  const handlers = {
    compact: false, canPost: conversation.canPost, onDelete: setDeleting, onEdited: replace, onGone: remove,
    onRetry: retry, onCancel: cancel, onExpired: () => {},
    onReactions: (messageId: number, reactions: ReactionView[]) => update((current) => ({
      ...current,
      parent: current.parent.id === messageId ? { ...current.parent, reactions } : current.parent,
      items: current.items.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
    })),
  }
  const where = conversation.dmPartner ? conversation.dmPartner.displayName : `# ${conversation.name ?? ''}`

  return (
    <aside className={styles.panel} aria-label="スレッド">
      <div className={styles.head}>
        {/* 画面の横幅が 600px 未満のときは左に「←」（画面設計書 7.2） */}
        <button type="button" className={styles.back} aria-label="会話に戻る" onClick={onClose}>←</button>
        <h2 className={styles.title}>スレッド <span className={styles.where}>{where}</span></h2>
        <button type="button" className={styles.close} aria-label="スレッドを閉じる" title="閉じる" onClick={onClose}>✕</button>
      </div>
      {loaded === 'failed' && (
        <div className={ui.empty}>
          <p>{M[48]}</p>
          <button type="button" className={ui.secondary}
            onClick={async () => {
              setLoaded(undefined)
              show(await load())
            }}>
            再読み込み
          </button>
        </div>
      )}
      {typeof loaded === 'object' && (
        <>
          <div ref={list} className={styles.list} onScroll={handleScroll}>
            {loadingOlder && <p className={styles.loading}>読み込み中…</p>}
            <MessageItem entry={{ kind: 'sent', message: loaded.parent }} {...handlers} />
            {loaded.parent.replyCount > 0 && (
              <div className={styles.divider}><span>{loaded.parent.replyCount} 件の返信</span></div>
            )}
            {loaded.items.map((m) => <MessageItem key={m.id} entry={{ kind: 'sent', message: m }} {...handlers} />)}
            {pending.map((p) => <MessageItem key={p.clientId} entry={p} {...handlers} />)}
          </div>
          {conversation.canPost
            ? <Composer value={draft} onChange={setDraft} onSend={send} uploads={uploads} placeholder="返信する…"
              conversationId={conversation.id} />
            : (
              // 送れない会話では、入力欄の代わりに理由を出す（TH-8）
              <p className={styles.cannotPost}>
                {conversation.type === 'DM' && conversation.dmPartner ? M36(conversation.dmPartner.displayName) : M[30]}
              </p>
            )}
        </>
      )}
      {deleting && (
        <DeleteMessageDialog message={deleting} onClose={() => setDeleting(null)}
          onDeleted={(result) => {
            if (result) replace(result)
            else remove(deleting.id)
            setDeleting(null)
          }}
          onGone={() => {
            remove(deleting.id)
            setDeleting(null)
          }} />
      )}
    </aside>
  )
}
