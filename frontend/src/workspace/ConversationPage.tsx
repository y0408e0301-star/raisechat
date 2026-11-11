import { useCallback, useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import {
  ApiError, conversationUrl, fetchConversation, fetchMessages, markRead, sendMessage, type ConversationDetail,
  type MessageView,
} from '../api'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { loadDraft, saveDraft } from '../drafts'
import { M } from '../messages'
import Composer from './Composer'
import styles from './ConversationPage.module.css'
import DeleteMessageDialog from './DeleteMessageDialog'
import type { Entry } from './entries'
import MessageList from './MessageList'
import { useWorkspace } from './WorkspaceContext'

// G-5 の会話（画面設計書 7.1）。会話を切り替えたら読み込み直すよう、ID ごとに作り直す
export default function ConversationPage() {
  const { conversationId } = useParams()
  return <ConversationView key={conversationId} conversationId={Number(conversationId)} />
}

type Loaded = { conversation: ConversationDetail, items: MessageView[], hasMoreBefore: boolean }

type Pending = Extract<Entry, { kind: 'pending' }>

// 読み込んだメッセージの最後のもの（既読の位置。メッセージがなければ 0）
const lastId = (items: MessageView[]) => items.at(-1)?.id ?? 0

function ConversationView({ conversationId }: { conversationId: number }) {
  const { workspace, showSidebar } = useWorkspace()
  const { me } = useAuth()
  const toast = useToast()
  // undefined：読み込み中、'failed'：読み込みに失敗、'notFound'：見られない
  const [loaded, setLoaded] = useState<Loaded | 'failed' | 'notFound' | undefined>(undefined)
  const [pending, setPending] = useState<Pending[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderFailed, setOlderFailed] = useState(false)
  const [deleting, setDeleting] = useState<MessageView | null>(null)
  // 入力の文。会話ごとに覚えておき、戻ってきたときに戻す（MS-15）
  const [draft, setDraftState] = useState(() => loadDraft(conversationId))

  const setDraft = useCallback((text: string) => {
    setDraftState(text)
    saveDraft(conversationId, text)
  }, [conversationId])

  const load = useCallback(async (): Promise<Loaded | 'failed' | 'notFound'> => {
    try {
      const [conversation, page] = await Promise.all([fetchConversation(conversationId), fetchMessages(conversationId)])
      // ほかのワークスペースの会話の ID を URL に入れられても、このワークスペースの中では見られないものとして扱う
      if (conversation.workspaceId !== workspace.id) return 'notFound'
      return { conversation, items: page.items, hasMoreBefore: page.hasMoreBefore }
    } catch (e) {
      return e instanceof ApiError && e.status === 404 ? 'notFound' : 'failed'
    }
  }, [conversationId, workspace.id])

  const show = useCallback((result: Loaded | 'failed' | 'notFound') => {
    setLoaded(result)
    // 見られない会話は M-27 を出して general を開く（画面設計書 7.1）
    if (result === 'notFound') toast(M[27])
    // 開いた会話と、読んだところを記録する（W-4、FN-14）
    if (typeof result === 'object') markRead(conversationId, lastId(result.items)).catch(() => {})
  }, [conversationId, toast])

  useEffect(() => {
    let active = true
    async function first() {
      const result = await load()
      if (active) show(result)
    }
    void first()
    return () => {
      active = false
    }
  }, [load, show])

  async function reload() {
    setLoaded(undefined)
    show(await load())
  }

  const updateItems = useCallback((change: (items: MessageView[]) => MessageView[]) => {
    setLoaded((current) => (typeof current === 'object' ? { ...current, items: change(current.items) } : current))
  }, [])

  // 送る。返ってきたら「送信中」を普通の表示に替える。同じメッセージを 2 つ出さないよう ID で見分ける（FN-07 5 章の 7）
  const post = useCallback(async (clientId: string, body: string) => {
    try {
      const sent = await sendMessage(conversationId, body, clientId)
      setPending((list) => list.filter((p) => p.clientId !== clientId))
      updateItems((items) => (items.some((m) => m.id === sent.id) ? items : [...items, sent]))
      markRead(conversationId, sent.id).catch(() => {})
    } catch {
      // 送れなかったものは一覧に残し、M-34 と「もう一度送る」「取り消す」を出す（MS-13）
      setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, failed: true } : p)))
    }
  }, [conversationId, updateItems])

  function send(body: string) {
    if (!me) return
    const clientId = crypto.randomUUID()
    setPending((list) => [...list,
      { kind: 'pending', clientId, author: me, body, createdAt: new Date().toISOString(), failed: false }])
    setDraft('')
    void post(clientId, body)
  }

  // もう一度送る。同じ clientId で送るので、前の送信が届いていても 2 つにならない（TC-07-12）
  function retry(clientId: string) {
    const target = pending.find((p) => p.clientId === clientId)
    if (!target) return
    setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, failed: false } : p)))
    void post(clientId, target.body)
  }

  // 取り消す。一覧から消して、本文を入力欄に戻す（MS-13）
  function cancel(clientId: string) {
    const target = pending.find((p) => p.clientId === clientId)
    if (!target) return
    setPending((list) => list.filter((p) => p.clientId !== clientId))
    setDraft(draft ? `${target.body}\n${draft}` : target.body)
  }

  // 上まで戻ったら、前の 50 件を読み込む（MS-2）
  async function loadOlder() {
    if (typeof loaded !== 'object' || loaded.items.length === 0) return
    setLoadingOlder(true)
    setOlderFailed(false)
    try {
      const page = await fetchMessages(conversationId, loaded.items[0].id)
      setLoaded((current) => (typeof current === 'object'
        ? { ...current, items: [...page.items, ...current.items], hasMoreBefore: page.hasMoreBefore }
        : current))
    } catch {
      setOlderFailed(true)
    } finally {
      setLoadingOlder(false)
    }
  }

  if (loaded === 'notFound') {
    // general も見られないとき（ワークスペースから外されたなど）は G-3 に戻す
    const general = workspace.generalConversationId
    return <Navigate to={conversationId === general ? '/' : conversationUrl(workspace.id, general)} replace />
  }

  const conversation = typeof loaded === 'object' ? loaded.conversation : null
  const entries: Entry[] = typeof loaded === 'object'
    ? [...loaded.items.map((message): Entry => ({ kind: 'sent', message })), ...pending]
    : []

  return (
    <>
      <div className={styles.head}>
        {/* 画面の横幅が 600px 未満のときだけ出す（2.19） */}
        <button type="button" className={styles.back} aria-label="サイドバーに戻る" onClick={showSidebar}>←</button>
        {conversation && (
          <div className={styles.titles}>
            <h1 className={styles.name}>
              <span aria-hidden="true">{conversation.visibility === 'PRIVATE' ? '🔒 ' : '# '}</span>
              {conversation.name}
            </h1>
            {conversation.description && <p className={styles.description}>{conversation.description}</p>}
          </div>
        )}
        {conversation && (
          <span className={styles.members} aria-label={`メンバー ${conversation.memberCount} 人`}>
            👥 {conversation.memberCount}
          </span>
        )}
      </div>
      {loaded === 'failed' && (
        <div className={ui.empty}>
          <p>{M[48]}</p>
          <button type="button" className={ui.secondary} onClick={reload}>再読み込み</button>
        </div>
      )}
      {typeof loaded === 'object' && (
        <>
          {olderFailed && (
            <div className={styles.olderFailed}>
              <span>{M[48]}</span>
              <button type="button" className={ui.secondary} onClick={loadOlder}>再読み込み</button>
            </div>
          )}
          <MessageList conversation={loaded.conversation} entries={entries} hasMoreBefore={loaded.hasMoreBefore}
            loadingOlder={loadingOlder} onLoadOlder={loadOlder} onDelete={setDeleting}
            onEdited={(edited) => updateItems((items) => items.map((m) => (m.id === edited.id ? edited : m)))}
            onGone={(id) => updateItems((items) => items.filter((m) => m.id !== id))}
            onRetry={retry} onCancel={cancel} />
          {/* 送れない会話（参加していない公開チャンネル）の M-30 と「参加する」は、チャンネル（開発計画書 1-6）で足す */}
          {loaded.conversation.canPost && (
            <Composer value={draft} onChange={setDraft} onSend={send}
              placeholder={`# ${loaded.conversation.name} へのメッセージ`} />
          )}
        </>
      )}
      {deleting && (
        <DeleteMessageDialog message={deleting} onClose={() => setDeleting(null)}
          onDeleted={(result) => {
            const id = deleting.id
            updateItems((items) => (result ? items.map((m) => (m.id === id ? result : m)) : items.filter((m) => m.id !== id)))
            setDeleting(null)
          }}
          onGone={() => {
            const id = deleting.id
            updateItems((items) => items.filter((m) => m.id !== id))
            setDeleting(null)
          }} />
      )}
    </>
  )
}
