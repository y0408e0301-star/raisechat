import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import {
  ApiError, conversationUrl, fetchConversation, fetchMessage, fetchMessages, joinChannel, markRead, sendMessage,
  type AttachmentView, type ConversationDetail, type MessageView,
} from '../api'
import attachmentStyles from '../attachments/Attachments.module.css'
import { useUploads } from '../attachments/uploads'
import { useAuth } from '../auth/AuthContext'
import Avatar from '../components/Avatar'
import ProfileButton from '../profile/ProfileButton'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { loadDraft, saveDraft } from '../drafts'
import { M, M28, M36 } from '../messages'
import type { RealtimeEvent } from '../realtime/events'
import { useRealtime } from '../realtime/RealtimeContext'
import ChannelDetailsDialog from './ChannelDetailsDialog'
import Composer from './Composer'
import styles from './ConversationPage.module.css'
import DeleteMessageDialog from './DeleteMessageDialog'
import type { Entry } from './entries'
import { addMessage, applyEvent, settlePending, type Viewer } from './liveMessages'
import MessageList from './MessageList'
import { useWorkspace } from './WorkspaceContext'

// G-5 の会話（画面設計書 7.1）。会話を切り替えたら読み込み直すよう、ID ごとに作り直す。
// 開いている間はその会話の通知を購読し、ほかの人の送信・編集・削除を開き直さずに出す（MS-5、機能定義書 4.2）
export default function ConversationPage() {
  const { conversationId } = useParams()
  return <ConversationView key={conversationId} conversationId={Number(conversationId)} />
}

type Loaded = { conversation: ConversationDetail, items: MessageView[], hasMoreBefore: boolean }

type Pending = Extract<Entry, { kind: 'pending' }>

// 読み込んだメッセージの最後のもの（既読の位置。メッセージがなければ 0）
const lastId = (items: MessageView[]) => items.at(-1)?.id ?? 0

function ConversationView({ conversationId }: { conversationId: number }) {
  const { workspace, showSidebar, upsertConversation, removeConversation } = useWorkspace()
  const { me } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { subscribeConversation, subscribeUser, onReconnect } = useRealtime()
  // undefined：読み込み中、'failed'：読み込みに失敗、'notFound'：見られない
  const [loaded, setLoaded] = useState<Loaded | 'failed' | 'notFound' | undefined>(undefined)
  const [pending, setPending] = useState<Pending[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderFailed, setOlderFailed] = useState(false)
  const [deleting, setDeleting] = useState<MessageView | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [joining, setJoining] = useState(false)
  // 入力の文。会話ごとに覚えておき、戻ってきたときに戻す（MS-15）
  const [draft, setDraftState] = useState(() => loadDraft(conversationId))
  // 入力欄の添付（FN-09）。会話を移ったら、送っていないものは API に外してもらう
  const uploads = useUploads(conversationId, toast)
  // ファイルを会話の画面に重ねている間（ドラッグ＆ドロップ。AT-1）
  const [dragging, setDragging] = useState(false)
  // 添付の URL の期限切れで読み直している（または読み直した）メッセージ。同じものを何度も読み直さない（AT-10）
  const refreshed = useRef(new Set<number>())

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

  // 届いた通知を一覧に当てはめる。自分の操作の通知も届くが、ID で見分けて 2 つ出さない（FN-07 5 章の 7）。
  // DM ではオーナーでもほかの人のメッセージを削除できない（FN-12 5 章の 6）
  const isDm = typeof loaded === 'object' && loaded.conversation.type === 'DM'
  const owner = workspace.role === 'OWNER' && !isDm
  useEffect(() => {
    if (!me) return
    const viewer: Viewer = { me, owner }
    return subscribeConversation(conversationId, (event: RealtimeEvent) => {
      if (event.conversationId !== conversationId) return
      setPending((list) => settlePending(list, event, viewer))
      updateItems((items) => applyEvent(items, event, viewer))
    })
  }, [subscribeConversation, conversationId, me, owner, updateItems])

  // 開いている会話から抜けた・削除されたら general に移る。削除のときは M-28 を出す（CH-8・CH-10、画面設計書 7.3）
  const generalUrl = conversationUrl(workspace.id, workspace.generalConversationId)
  const name = useRef('')
  const loadedName = typeof loaded === 'object' ? (loaded.conversation.name ?? '') : ''
  useEffect(() => {
    name.current = loadedName
  }, [loadedName])
  // 開いている会話の送れるか・DM の相手が変わったら（相手がキック・退出・また参加した。FN-05 MB-8）、入力欄をすぐ替える
  useEffect(() => subscribeUser((event: RealtimeEvent) => {
    if (event.type !== 'conversation.updated' || event.payload.id !== conversationId) return
    const { canPost, joined, dmPartner } = event.payload
    setLoaded((current) => (typeof current === 'object'
      ? { ...current, conversation: { ...current.conversation, canPost, joined, dmPartner } }
      : current))
  }), [subscribeUser, conversationId])

  useEffect(() => subscribeUser((event: RealtimeEvent) => {
    if (event.type !== 'conversation.removed' || event.payload.conversationId !== conversationId) return
    if (event.payload.reason === 'DELETED') toast(M28(name.current))
    navigate(generalUrl, { replace: true })
  }), [subscribeUser, conversationId, toast, navigate, generalUrl])

  // つなぎ直したら、切れていた間の取りこぼしをなくすため、会話と最新の 50 件を取り直して置き換える（機能定義書 4.4）。
  // 見られなくなっていたら、開いたときと同じく M-27 を出して general に移す
  useEffect(() => onReconnect(async () => {
    const result = await load()
    if (result === 'failed') return
    if (result === 'notFound') show(result)
    else setLoaded(result)
  }), [onReconnect, load, show])

  // 送る。返ってきたら「送信中」を普通の表示に替える。同じメッセージを 2 つ出さないよう ID で見分ける（FN-07 5 章の 7）
  const post = useCallback(async (clientId: string, body: string, attachments: AttachmentView[]) => {
    try {
      const sent = await sendMessage(conversationId, body, clientId, attachments.map((a) => a.id))
      setPending((list) => list.filter((p) => p.clientId !== clientId))
      updateItems((items) => addMessage(items, sent))
      markRead(conversationId, sent.id).catch(() => {})
    } catch {
      // 送れなかったものは一覧に残し、M-34 と「もう一度送る」「取り消す」を出す（MS-13）
      setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, failed: true } : p)))
    }
  }, [conversationId, updateItems])

  function send(body: string, attachments: AttachmentView[]) {
    if (!me) return
    const clientId = crypto.randomUUID()
    setPending((list) => [...list,
      { kind: 'pending', clientId, author: me, body, attachments, createdAt: new Date().toISOString(), failed: false }])
    setDraft('')
    void post(clientId, body, attachments)
  }

  // もう一度送る。同じ clientId で送るので、前の送信が届いていても 2 つにならない（TC-07-12）
  function retry(clientId: string) {
    const target = pending.find((p) => p.clientId === clientId)
    if (!target) return
    setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, failed: false } : p)))
    void post(clientId, target.body, target.attachments)
  }

  // 取り消す。一覧から消して、本文と添付を入力欄に戻す（MS-13）
  function cancel(clientId: string) {
    const target = pending.find((p) => p.clientId === clientId)
    if (!target) return
    setPending((list) => list.filter((p) => p.clientId !== clientId))
    setDraft(draft ? `${target.body}\n${draft}` : target.body)
    uploads.restore(target.attachments)
  }

  // 添付が表示できなかった（署名付き URL の期限切れ）。メッセージを読み直して新しい URL に替える（AT-10）。
  // 読み直しても表示できないものを繰り返し読み直さないよう、1 つのメッセージにつき 1 回だけにする
  const refreshMessage = useCallback(async (messageId: number) => {
    if (refreshed.current.has(messageId)) return
    refreshed.current.add(messageId)
    try {
      const fresh = await fetchMessage(messageId)
      updateItems((items) => items.map((m) => (m.id === messageId ? { ...fresh, mine: m.mine, canDelete: m.canDelete } : m)))
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) updateItems((items) => items.filter((m) => m.id !== messageId))
    }
  }, [updateItems])

  // ファイルを会話の画面に重ねたら点線の枠を出し、落としたら添付する（AT-1）。送れない会話では受けない
  const canAttach = typeof loaded === 'object' && loaded.conversation.canPost
  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!canAttach || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragging(true)
  }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    setDragging(false)
    if (!canAttach || e.dataTransfer.files.length === 0) return
    e.preventDefault()
    uploads.add(Array.from(e.dataTransfer.files))
  }

  // 参加していない公開チャンネルの「参加する」。入力欄を出し、サイドバーにも足す（CH-5）
  async function join() {
    setJoining(true)
    try {
      const joined = await joinChannel(conversationId)
      setLoaded((current) => (typeof current === 'object' ? { ...current, conversation: joined } : current))
      upsertConversation(joined)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : M[49])
    } finally {
      setJoining(false)
    }
  }

  // 自分で退出・削除したら、サイドバーから消して general に移る（CH-8・CH-9）
  function leaveConversation() {
    setDetailsOpen(false)
    removeConversation(conversationId)
    navigate(generalUrl, { replace: true })
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
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className={styles.page} onDragOver={handleDragOver} onDrop={handleDrop}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}>
      {dragging && <div className={attachmentStyles.dropZone}>ドロップして添付</div>}
      <div className={styles.head}>
        {/* 画面の横幅が 600px 未満のときだけ出す（2.19） */}
        <button type="button" className={styles.back} aria-label="サイドバーに戻る" onClick={showSidebar}>←</button>
        {conversation?.type === 'DM' && conversation.dmPartner && (
          // DM の見出し：相手のアバター・表示名・@ユーザー ID・ステータス（DM-5）。アバターと表示名を押すと G-16。
          // 見出し（h1）はボタンの中に置けないので、アバターと見出しの中の表示名をそれぞれボタンにする
          <div className={styles.partner}>
            <ProfileButton user={conversation.dmPartner} label={`${conversation.dmPartner.displayName}のプロフィール`}>
              <Avatar displayName={conversation.dmPartner.displayName} avatarUrl={conversation.dmPartner.avatarUrl} size={32} />
            </ProfileButton>
            <div className={styles.titles}>
              <h1 className={styles.name}>
                <ProfileButton user={conversation.dmPartner}>{conversation.dmPartner.displayName}</ProfileButton>
                <span className={styles.username}>@{conversation.dmPartner.username}</span>
              </h1>
              {(conversation.dmPartner.statusEmoji || conversation.dmPartner.statusText) && (
                <p className={styles.description}>
                  {[conversation.dmPartner.statusEmoji, conversation.dmPartner.statusText].filter(Boolean).join(' ')}
                </p>
              )}
            </div>
          </div>
        )}
        {conversation?.type === 'CHANNEL' && (
          <div className={styles.titles}>
            <h1 className={styles.name}>
              {/* 名前・人数・ⓘ を押すと G-14（CH-6） */}
              <button type="button" className={styles.titleButton} onClick={() => setDetailsOpen(true)}>
                <span aria-hidden="true">{conversation.visibility === 'PRIVATE' ? '🔒 ' : '# '}</span>
                {conversation.name}
              </button>
            </h1>
            {conversation.description && <p className={styles.description}>{conversation.description}</p>}
          </div>
        )}
        {conversation?.type === 'CHANNEL' && (
          <>
            <button type="button" className={styles.members} onClick={() => setDetailsOpen(true)}
              aria-label={`メンバー ${conversation.memberCount} 人`}>
              👥 {conversation.memberCount}
            </button>
            <button type="button" className={styles.info} onClick={() => setDetailsOpen(true)}
              aria-label="チャンネルの詳細" title="チャンネルの詳細">ⓘ</button>
          </>
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
            onRetry={retry} onCancel={cancel} onExpired={refreshMessage} />
          {loaded.conversation.canPost
            ? (
              <Composer value={draft} onChange={setDraft} onSend={send} uploads={uploads}
                placeholder={loaded.conversation.dmPartner
                  ? `${loaded.conversation.dmPartner.displayName} へのメッセージ`
                  : `# ${loaded.conversation.name} へのメッセージ`} />
            )
            : (
              // 送れない会話は、入力欄の代わりに理由を出す（MS-16）。参加していない公開チャンネルは「参加する」も出す（CH-5）
              <div className={styles.cannotPost}>
                <p>
                  {loaded.conversation.type === 'DM' && loaded.conversation.dmPartner
                    ? M36(loaded.conversation.dmPartner.displayName)
                    : M[30]}
                </p>
                {loaded.conversation.type === 'CHANNEL' && !loaded.conversation.joined && (
                  <button type="button" className={ui.primary} onClick={join} disabled={joining}>
                    {joining ? '参加中…' : '参加する'}
                  </button>
                )}
              </div>
            )}
        </>
      )}
      {detailsOpen && typeof loaded === 'object' && loaded.conversation.type === 'CHANNEL' && (
        <ChannelDetailsDialog channel={loaded.conversation} owner={workspace.role === 'OWNER'}
          onClose={() => setDetailsOpen(false)}
          onInvited={(count) => setLoaded((current) => (typeof current === 'object'
            ? { ...current, conversation: { ...current.conversation, memberCount: current.conversation.memberCount + count } }
            : current))}
          onLeft={leaveConversation} onDeleted={leaveConversation} />
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
    </div>
  )
}
