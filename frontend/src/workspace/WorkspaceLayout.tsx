import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useNavigate, useParams } from 'react-router'
import {
  ApiError, conversationUrl, dmUrl, fetchConversations, fetchWorkspace, type ConversationSummary, type WorkspaceDetail,
} from '../api'
import AppHeader from '../components/AppHeader'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M, M15, M22 } from '../messages'
import ProfileDialog from '../profile/ProfileDialog'
import { ProfileContext, type OpenProfile } from '../profile/ProfileContext'
import type { RealtimeEvent } from '../realtime/events'
import { useRealtime } from '../realtime/RealtimeContext'
import CreateChannelDialog from './CreateChannelDialog'
import Sidebar from './Sidebar'
import StartDmDialog from './StartDmDialog'
import { removeConversation, upsertConversation } from './sidebarList'
import type { WorkspaceContext } from './WorkspaceContext'
import styles from './WorkspaceLayout.module.css'

// G-5 チャット画面の枠（画面設計書 7 章）：ワークスペース用のヘッダー・サイドバー・会話・G-8（Outlet）。
// ワークスペースを切り替えたら読み込み直すよう、ID ごとに作り直す。
// 本人あての通知（conversation.updated・removed）で、ほかのタブ・招待・削除をサイドバーにすぐ反映する（CH-7・CH-10）
export default function WorkspaceLayout() {
  const { workspaceId } = useParams()
  return <WorkspaceView key={workspaceId} workspaceId={Number(workspaceId)} />
}

type Loaded = { workspace: WorkspaceDetail, conversations: ConversationSummary[] }

function WorkspaceView({ workspaceId }: { workspaceId: number }) {
  const toast = useToast()
  // undefined：読み込み中、'failed'：読み込みに失敗、'notFound'：入っていない・存在しない、'removed'：開いている間に外れた
  const [loaded, setLoaded] = useState<Loaded | 'failed' | 'notFound' | 'removed' | undefined>(undefined)
  // 画面の横幅が 600px 未満のとき、サイドバーと会話のどちらを出すか（画面設計書 2.19）
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [startingDm, setStartingDm] = useState(false)
  // G-16 で見ている人と、押した名前・アバター
  const [profile, setProfile] = useState<{ user: Parameters<OpenProfile>[0], anchor: HTMLElement } | null>(null)
  const openProfile = useCallback<OpenProfile>((user, anchor) => setProfile({ user, anchor }), [])
  const { onReconnect, subscribeUser } = useRealtime()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) return 'notFound' as const
    try {
      const [workspace, conversations] = await Promise.all([fetchWorkspace(workspaceId), fetchConversations(workspaceId)])
      return { workspace, conversations }
    } catch (e) {
      return e instanceof ApiError && e.status === 404 ? 'notFound' as const : 'failed' as const
    }
  }, [workspaceId])

  useEffect(() => {
    let active = true
    async function first() {
      const result = await load()
      if (!active) return
      // 入っていない・存在しないワークスペースは、M-13 を出して G-3 に移す（W-8）
      if (result === 'notFound') toast(M[13])
      setLoaded(result)
    }
    void first()
    return () => {
      active = false
    }
  }, [load, toast])

  // つなぎ直したら、切れていた間の変化（未読・メンションの件数を含む。FN-14 5 章の 8）を反映するため、
  // ワークスペースとサイドバーの会話を取り直す（機能定義書 4.4）。
  // ワークスペースから外されていたら、開いたときと同じく M-13 を出して G-3 に移す
  useEffect(() => onReconnect(async () => {
    try {
      const [workspace, conversations] = await Promise.all([fetchWorkspace(workspaceId), fetchConversations(workspaceId)])
      setLoaded((current) => (typeof current === 'object' ? { workspace, conversations } : current))
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        toast(M[13])
        setLoaded('notFound')
      }
    }
  }), [onReconnect, workspaceId, toast])

  // 自分がオーナーか（通知の受け取りで使う。effect の付け直しをしないよう ref に持つ）
  const owner = useRef(false)
  useEffect(() => {
    if (typeof loaded === 'object') owner.current = loaded.workspace.role === 'OWNER'
  }, [loaded])

  const changeConversations = useCallback((change: (list: ConversationSummary[]) => ConversationSummary[]) => {
    setLoaded((current) => (typeof current === 'object' ? { ...current, conversations: change(current.conversations) } : current))
  }, [])

  // ほかのワークスペースの通知は、そのワークスペースを開いたときに読み直すので無視する。
  // このワークスペースから外れたら G-3 に移す。キックされたら M-22、削除されたら M-15 を出す（MB-4・W-7）。
  // 削除したオーナー・退出した本人は自分の操作なので出さない
  useEffect(() => subscribeUser((event: RealtimeEvent) => {
    if (event.workspaceId !== workspaceId) return
    if (event.type === 'workspace.removed') {
      const { name, reason } = event.payload
      if (reason === 'KICKED') toast(M22(name))
      if (reason === 'DELETED' && !owner.current) toast(M15(name))
      setLoaded('removed')
      return
    }
    if (event.type === 'conversation.updated') changeConversations((list) => upsertConversation(list, event.payload))
    // ヘッダー・サイドバーの「メンション」の件数（NT-2・NT-6）
    if (event.type === 'workspace.updated') {
      const { hasUnread, mentionCount } = event.payload
      setLoaded((current) => (typeof current === 'object'
        ? { ...current, workspace: { ...current.workspace, hasUnread, mentionCount } }
        : current))
    }
    if (event.type === 'conversation.removed') {
      const removedId = event.payload.conversationId
      changeConversations((list) => removeConversation(list, removedId))
    }
  }), [subscribeUser, workspaceId, changeConversations, toast])

  async function reload() {
    setLoaded(undefined)
    setLoaded(await load())
  }

  if (loaded === 'notFound' || loaded === 'removed') return <Navigate to="/" replace />
  if (loaded === undefined || loaded === 'failed') {
    return (
      <>
        <AppHeader />
        {loaded === 'failed' && (
          <div className={ui.empty}>
            <p>{M[48]}</p>
            <button type="button" className={ui.secondary} onClick={reload}>再読み込み</button>
          </div>
        )}
      </>
    )
  }

  const context: WorkspaceContext = {
    ...loaded,
    showSidebar: () => setSidebarOpen(true),
    upsertConversation: (summary) => changeConversations((list) => upsertConversation(list, summary)),
    removeConversation: (id) => changeConversations((list) => removeConversation(list, id)),
    openCreateChannel: () => setCreating(true),
  }
  return (
    <ProfileContext value={openProfile}>
      <div className={styles.page}>
        <AppHeader workspace={loaded.workspace} />
        <div className={`${styles.body} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
          <Sidebar workspace={loaded.workspace} conversations={loaded.conversations}
            onSelect={() => setSidebarOpen(false)} onCreateChannel={() => setCreating(true)}
            onStartDm={() => setStartingDm(true)} />
          <main className={styles.main}>
            <Outlet context={context} />
          </main>
        </div>
        {creating && (
          // G-13。作ったらサイドバーに足し、G-5 でそのチャンネルを開く（CH-2）
          <CreateChannelDialog workspaceId={workspaceId} onClose={() => setCreating(false)}
            onCreated={(created) => {
              setCreating(false)
              context.upsertConversation(created)
              setSidebarOpen(false)
              navigate(conversationUrl(workspaceId, created.id))
            }} />
        )}
        {startingDm && (
          // G-15。選んだ人との DM をサイドバーに足し、G-5 で開く（DM-2）
          <StartDmDialog workspaceId={workspaceId} onClose={() => setStartingDm(false)}
            onStarted={(dm) => {
              setStartingDm(false)
              context.upsertConversation(dm)
              setSidebarOpen(false)
              navigate(dmUrl(workspaceId, dm.id))
            }} />
        )}
        {profile && (
          // G-16。「メッセージを送る」で、その人との DM をサイドバーに足し、G-5 で開く（DM-3）
          <ProfileDialog workspaceId={workspaceId} user={profile.user} anchor={profile.anchor}
            onClose={() => setProfile(null)}
            onStartDm={(dm) => {
              setProfile(null)
              context.upsertConversation(dm)
              setSidebarOpen(false)
              navigate(dmUrl(workspaceId, dm.id))
            }} />
        )}
      </div>
    </ProfileContext>
  )
}
