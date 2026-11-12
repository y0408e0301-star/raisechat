import { useCallback, useEffect, useState } from 'react'
import { Navigate, Outlet, useParams } from 'react-router'
import {
  ApiError, fetchConversations, fetchWorkspace, type ConversationSummary, type WorkspaceDetail,
} from '../api'
import AppHeader from '../components/AppHeader'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M } from '../messages'
import { useRealtime } from '../realtime/RealtimeContext'
import Sidebar from './Sidebar'
import type { WorkspaceContext } from './WorkspaceContext'
import styles from './WorkspaceLayout.module.css'

// G-5 チャット画面の枠（画面設計書 7 章）：ワークスペース用のヘッダー・サイドバー・会話（Outlet）。
// ワークスペースを切り替えたら読み込み直すよう、ID ごとに作り直す
export default function WorkspaceLayout() {
  const { workspaceId } = useParams()
  return <WorkspaceView key={workspaceId} workspaceId={Number(workspaceId)} />
}

type Loaded = { workspace: WorkspaceDetail, conversations: ConversationSummary[] }

function WorkspaceView({ workspaceId }: { workspaceId: number }) {
  const toast = useToast()
  // undefined：読み込み中、'failed'：読み込みに失敗、'notFound'：入っていない・存在しない
  const [loaded, setLoaded] = useState<Loaded | 'failed' | 'notFound' | undefined>(undefined)
  // 画面の横幅が 600px 未満のとき、サイドバーと会話のどちらを出すか（画面設計書 2.19）
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { onReconnect } = useRealtime()

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

  // つなぎ直したら、切れていた間の変化を反映するためサイドバーの会話を取り直す（機能定義書 4.4）。
  // ワークスペースから外されていたら、開いたときと同じく M-13 を出して G-3 に移す
  useEffect(() => onReconnect(async () => {
    try {
      const conversations = await fetchConversations(workspaceId)
      setLoaded((current) => (typeof current === 'object' ? { ...current, conversations } : current))
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        toast(M[13])
        setLoaded('notFound')
      }
    }
  }), [onReconnect, workspaceId, toast])

  async function reload() {
    setLoaded(undefined)
    setLoaded(await load())
  }

  if (loaded === 'notFound') return <Navigate to="/" replace />
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

  const context: WorkspaceContext = { ...loaded, showSidebar: () => setSidebarOpen(true) }
  return (
    <div className={styles.page}>
      <AppHeader workspace={loaded.workspace} />
      <div className={`${styles.body} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <Sidebar workspace={loaded.workspace} conversations={loaded.conversations}
          onSelect={() => setSidebarOpen(false)} />
        <main className={styles.main}>
          <Outlet context={context} />
        </main>
      </div>
    </div>
  )
}
