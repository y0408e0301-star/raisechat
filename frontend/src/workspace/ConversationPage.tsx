import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ApiError, conversationUrl, fetchConversation, fetchMessage, fetchMessages, fetchMessagesAround, fetchNewerMessages,
  joinChannel, markRead, sendMessage, type AttachmentView, type ConversationDetail, type Me, type MessageView,
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
import { usePageVisible } from '../visibility'
import ChannelDetailsDialog from './ChannelDetailsDialog'
import Composer from './Composer'
import styles from './ConversationPage.module.css'
import DeleteMessageDialog from './DeleteMessageDialog'
import type { Entry } from './entries'
import { addMessage, applyEvent, settlePending, type Viewer } from './liveMessages'
import MessageList from './MessageList'
import ThreadPanel from './ThreadPanel'
import { useWorkspace } from './WorkspaceContext'

// G-5 の会話（画面設計書 7.1）。会話を切り替えたら読み込み直すよう、ID ごとに作り直す。
// 開いている間はその会話の通知を購読し、ほかの人の送信・編集・削除を開き直さずに出す（MS-5、機能定義書 4.2）。
// 画面が見えている間は、読み込んだ最後のメッセージまで読んだことにする（FN-14 NT-4）。
// ?message={ID} で開いたときは、そのメッセージの前後を読み込んで目立たせ、URL から外す（MS-14）
export default function ConversationPage() {
  const { conversationId } = useParams()
  return <ConversationView key={conversationId} conversationId={Number(conversationId)} />
}

type Loaded = {
  conversation: ConversationDetail
  items: MessageView[]
  hasMoreBefore: boolean
  // 後ろにまだ読んでいないメッセージがある（メッセージの位置を開いたとき。MS-14）
  hasMoreAfter: boolean
  // 「新着」の線を上に出すメッセージ（開いたときの最初の未読。MS-1）
  newSince: number | null
  // 目立たせるメッセージ（MS-14）と、あわせて開くスレッド（スレッドの返信を開いたとき）
  highlightId: number | null
  threadOf: number | null
}

type Pending = Extract<Entry, { kind: 'pending' }>

// 読み込んだメッセージの最後のもの（既読の位置。メッセージがなければ 0）
const lastId = (items: MessageView[]) => items.at(-1)?.id ?? 0

// 最初の未読（最後に読んだものより後で、ほかの人が送り、削除されていないもの。FN-14 5 章の 1）。
// 会話のメンバーでなければ（lastReadMessageId が null）出さない
function firstUnread(items: MessageView[], lastRead: number | null | undefined, me: Me | null | undefined) {
  if (lastRead === null || lastRead === undefined) return null
  return items.find((m) => m.id > lastRead && !m.deleted && m.author.username !== me?.username)?.id ?? null
}

// URL の ?message= の ID。なければ null
function messageParam(value: string | null): number | null {
  const id = Number(value)
  return value !== null && Number.isSafeInteger(id) && id > 0 ? id : null
}

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
  const [loadingNewer, setLoadingNewer] = useState(false)
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
  // 開いているスレッド（親メッセージの ID）。URL の ?thread= に入れ、読み込み直しても開いたままにする（TH-6）
  const [searchParams, setSearchParams] = useSearchParams()
  const threadParam = Number(searchParams.get('thread'))
  const threadId = Number.isInteger(threadParam) && threadParam > 0 ? threadParam : null
  const openingMessage = messageParam(searchParams.get('message'))
  const openThread = useCallback((messageId: number) => {
    setSearchParams((params) => {
      params.set('thread', String(messageId))
      return params
    })
  }, [setSearchParams])
  const closeThread = useCallback(() => {
    setSearchParams((params) => {
      params.delete('thread')
      return params
    }, { replace: true })
  }, [setSearchParams])

  const setDraft = useCallback((text: string) => {
    setDraftState(text)
    saveDraft(conversationId, text)
  }, [conversationId])

  // 最新の 50 件か、around（そのメッセージの前後。MS-14）を読む。around のメッセージがもうなければ最新を読む。
  // スレッドの返信を開いたときは、その親を目立たせてスレッドも開く（FN-07 6 章）
  const load = useCallback(async (around: number | null = null): Promise<Loaded | 'failed' | 'notFound'> => {
    try {
      const latest = () => fetchMessages(conversationId)
      const [conversation, page] = await Promise.all([fetchConversation(conversationId), around === null
        ? latest()
        : fetchMessagesAround(conversationId, around).catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return latest()
          throw e
        })])
      // ほかのワークスペースの会話の ID を URL に入れられても、このワークスペースの中では見られないものとして扱う
      if (conversation.workspaceId !== workspace.id) return 'notFound'
      let highlightId: number | null = null
      let threadOf: number | null = null
      if (around !== null && page.items.some((m) => m.id === around)) {
        highlightId = around
      } else if (around !== null) {
        const parentId = await fetchMessage(around).then((m) => m.parentId, () => null)
        if (parentId !== null && page.items.some((m) => m.id === parentId)) {
          highlightId = parentId
          threadOf = parentId
        }
      }
      return {
        conversation, items: page.items, hasMoreBefore: page.hasMoreBefore, hasMoreAfter: page.hasMoreAfter,
        newSince: firstUnread(page.items, conversation.lastReadMessageId, me), highlightId, threadOf,
      }
    } catch (e) {
      return e instanceof ApiError && e.status === 404 ? 'notFound' : 'failed'
    }
  }, [conversationId, workspace.id, me])

  const show = useCallback((result: Loaded | 'failed' | 'notFound') => {
    setLoaded(result)
    // 見られない会話は M-27 を出して general を開く（画面設計書 7.1）
    if (result === 'notFound') toast(M[27])
  }, [toast])

  // 開いたとき、または ?message= が付いたとき（開いている会話の通知を押したときなど）に読み込む。
  // ?message= は読み込んだら URL から外す。外しただけでは読み直さない
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current && openingMessage === null) return
    opened.current = true
    async function open() {
      const result = await load(openingMessage)
      show(result)
      if (openingMessage === null) return
      setSearchParams((params) => {
        params.delete('message')
        if (typeof result === 'object' && result.threadOf !== null) params.set('thread', String(result.threadOf))
        return params
      }, { replace: true })
    }
    void open()
  }, [load, show, openingMessage, setSearchParams])

  async function reload() {
    setLoaded(undefined)
    show(await load())
  }

  // 見えている間は、読み込んだ最後のメッセージまで読んだことにする。開いた会話も記録する（NT-4、W-4）。
  // 届いた・送った・タブが前に来たときにも記録する（TC-14-4）
  const visible = usePageVisible()
  const readUpTo = typeof loaded === 'object' ? lastId(loaded.items) : null
  useEffect(() => {
    if (!visible || readUpTo === null) return
    markRead(conversationId, readUpTo).catch(() => {})
  }, [visible, readUpTo, conversationId])

  // 後ろにまだ読んでいないメッセージがある間は、届いたメッセージを足さない（間が抜けるため。下へ読み進めると出る）
  const hasMoreAfter = useRef(false)
  useEffect(() => {
    hasMoreAfter.current = typeof loaded === 'object' && loaded.hasMoreAfter
  }, [loaded])

  const updateItems = useCallback((change: (items: MessageView[]) => MessageView[]) => {
    setLoaded((current) => (typeof current === 'object' ? { ...current, items: change(current.items) } : current))
  }, [])

  // 届いた通知を一覧に当てはめる。自分の操作の通知も届くが、ID で見分けて 2 つ出さない（FN-07 5 章の 7）。
  // DM ではオーナーでもほかの人のメッセージを削除できない（FN-12 5 章の 6）
  const isDm = typeof loaded === 'object' && loaded.conversation.type === 'DM'
  const owner = workspace.role === 'OWNER' && !isDm
  const viewer = useMemo<Viewer | null>(() => (me ? { me, owner } : null), [me, owner])
  useEffect(() => {
    if (!viewer) return
    return subscribeConversation(conversationId, (event: RealtimeEvent) => {
      if (event.conversationId !== conversationId) return
      setPending((list) => settlePending(list, event, viewer))
      if (event.type === 'message.created' && hasMoreAfter.current) return
      updateItems((items) => applyEvent(items, event, viewer))
    })
  }, [subscribeConversation, conversationId, viewer, updateItems])

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
    // 「新着」の線は開き直すまで残す
    else setLoaded((current) => (typeof current === 'object' ? { ...result, newSince: current.newSince } : result))
  }), [onReconnect, load, show])

  // 送る。返ってきたら「送信中」を普通の表示に替える。同じメッセージを 2 つ出さないよう ID で見分ける（FN-07 5 章の 7）
  const post = useCallback(async (clientId: string, body: string, attachments: AttachmentView[]) => {
    try {
      const sent = await sendMessage(conversationId, body, clientId, attachments.map((a) => a.id))
      setPending((list) => list.filter((p) => p.clientId !== clientId))
      if (!hasMoreAfter.current) {
        updateItems((items) => addMessage(items, sent))
        return
      }
      // メッセージの位置を開いて上の方を見ていたときは、送ったものが見えるよう最新を読み直す
      const latest = await load()
      if (typeof latest === 'object') {
        setLoaded((current) => (typeof current === 'object' ? { ...latest, newSince: current.newSince } : latest))
      }
    } catch {
      // 送れなかったものは一覧に残し、M-34 と「もう一度送る」「取り消す」を出す（MS-13）
      setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, failed: true } : p)))
    }
  }, [conversationId, updateItems, load])

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

  // メッセージの位置を開いた後で下まで来たら、後ろを読み込む（MS-14）
  async function loadNewer() {
    if (typeof loaded !== 'object' || !loaded.hasMoreAfter || loadingNewer) return
    setLoadingNewer(true)
    try {
      const page = await fetchNewerMessages(conversationId, lastId(loaded.items))
      setLoaded((current) => (typeof current === 'object'
        ? { ...current, items: [...current.items, ...page.items.filter((m) => m.id > lastId(current.items))],
            hasMoreAfter: page.hasMoreAfter }
        : current))
    } catch {
      toast(M[48])
    } finally {
      setLoadingNewer(false)
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
    <div className={styles.layout}>
    {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
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
          <MessageList key={loaded.highlightId ?? 'latest'} conversation={loaded.conversation} entries={entries}
            hasMoreBefore={loaded.hasMoreBefore} loadingOlder={loadingOlder} onLoadOlder={loadOlder}
            hasMoreAfter={loaded.hasMoreAfter} loadingNewer={loadingNewer} onLoadNewer={loadNewer}
            newSince={loaded.newSince} highlightId={loaded.highlightId} onDelete={setDeleting}
            onEdited={(edited) => updateItems((items) => items.map((m) => (m.id === edited.id ? edited : m)))}
            onGone={(id) => updateItems((items) => items.filter((m) => m.id !== id))}
            onRetry={retry} onCancel={cancel} onExpired={refreshMessage} onOpenThread={openThread}
            onReactions={(id, reactions) => updateItems((items) => items.map((m) => (m.id === id ? { ...m, reactions } : m)))} />
          {loaded.conversation.canPost
            ? (
              <Composer value={draft} onChange={setDraft} onSend={send} uploads={uploads} conversationId={conversationId}
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
    {threadId !== null && typeof loaded === 'object' && viewer && (
      // スレッドのパネル（画面設計書 7.2）。スレッドを切り替えたら読み込み直すよう、親の ID ごとに作り直す
      <ThreadPanel key={threadId} conversation={loaded.conversation} parentId={threadId} viewer={viewer}
        onClose={closeThread} />
    )}
    </div>
  )
}
