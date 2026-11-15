import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { conversationUrl, fetchWorkspaces, workspaceUrl, type WorkspaceSummary } from '../api'
import CountBadge from '../components/CountBadge'
import ui from '../components/ui.module.css'
import { M } from '../messages'
import { useRealtime } from '../realtime/RealtimeContext'
import CreateWorkspaceDialog from './CreateWorkspaceDialog'
import styles from './WorkspacesPage.module.css'

// G-3 ワークスペースの一覧画面（W-1〜W-3、画面設計書 5 章）。
// 未読の太字とメンションの件数（NT-3）は、通知（workspace.updated）で開き直さずに変える（NT-6）。
// 外れたワークスペースは通知（workspace.removed）で一覧から消す
export default function WorkspacesPage() {
  const navigate = useNavigate()
  // undefined：読み込み中、null：読み込みに失敗
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const { subscribeUser } = useRealtime()

  const load = useCallback(async () => {
    setWorkspaces(undefined)
    setWorkspaces(await fetchWorkspaces().catch(() => null))
  }, [])

  // キック・退出・削除されたワークスペースは、開き直さずに一覧から消す（W-7）
  useEffect(() => subscribeUser((event) => {
    if (event.type === 'workspace.removed') {
      setWorkspaces((list) => list?.filter((w) => w.id !== event.workspaceId))
    }
    if (event.type === 'workspace.updated') {
      const { workspaceId, hasUnread, mentionCount } = event.payload
      setWorkspaces((list) => list?.map((w) => (w.id === workspaceId ? { ...w, hasUnread, mentionCount } : w)))
    }
  }), [subscribeUser])

  useEffect(() => {
    let active = true
    fetchWorkspaces().then((list) => active && setWorkspaces(list), () => active && setWorkspaces(null))
    return () => {
      active = false
    }
  }, [])

  return (
    <>
      <div className={styles.head}>
        <h1 className={styles.title}>ワークスペース</h1>
        <button type="button" className={ui.primary} onClick={() => setCreating(true)}>ワークスペースを作る</button>
      </div>
      {workspaces === null && (
        <div className={ui.empty}>
          <p>{M[48]}</p>
          <button type="button" className={ui.secondary} onClick={load}>再読み込み</button>
        </div>
      )}
      {workspaces?.length === 0 && <p className={ui.empty}>{M[16]}</p>}
      {workspaces && workspaces.length > 0 && (
        <ul className={styles.list}>
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link to={workspaceUrl(w.id)} className={`${styles.row} ${w.hasUnread ? styles.unread : ''}`}>
                <span className={styles.name}>{w.name}</span>
                {w.role === 'OWNER' && <span className={styles.owner}>オーナー</span>}
                <CountBadge count={w.mentionCount} label="メンション" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <CreateWorkspaceDialog onClose={() => setCreating(false)}
          // 作ったら G-5 で general を開く（W-3）
          onCreated={(w) => navigate(conversationUrl(w.id, w.generalConversationId))} />
      )}
    </>
  )
}
