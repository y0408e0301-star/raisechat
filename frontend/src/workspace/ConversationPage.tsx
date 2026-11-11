import { useCallback, useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { ApiError, conversationUrl, fetchConversation, markRead, type ConversationDetail } from '../api'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M } from '../messages'
import styles from './ConversationPage.module.css'
import { useWorkspace } from './WorkspaceContext'

// G-5 の会話（画面設計書 7.1）。会話を切り替えたら読み込み直すよう、ID ごとに作り直す
export default function ConversationPage() {
  const { conversationId } = useParams()
  return <ConversationView key={conversationId} conversationId={Number(conversationId)} />
}

function ConversationView({ conversationId }: { conversationId: number }) {
  const { workspace, showSidebar } = useWorkspace()
  const toast = useToast()
  // undefined：読み込み中、'failed'：読み込みに失敗、'notFound'：見られない
  const [conversation, setConversation] = useState<ConversationDetail | 'failed' | 'notFound' | undefined>(undefined)

  // 読み込む。見られないときは 'notFound'、それ以外の失敗は 'failed'
  const load = useCallback(async (): Promise<ConversationDetail | 'failed' | 'notFound'> => {
    try {
      const found = await fetchConversation(conversationId)
      // ほかのワークスペースの会話の ID を URL に入れられても、このワークスペースの中では見られないものとして扱う
      return found.workspaceId === workspace.id ? found : 'notFound'
    } catch (e) {
      return e instanceof ApiError && e.status === 404 ? 'notFound' : 'failed'
    }
  }, [conversationId, workspace.id])

  const show = useCallback((result: ConversationDetail | 'failed' | 'notFound') => {
    setConversation(result)
    // 見られない会話は M-27 を出して general を開く（画面設計書 7.1）
    if (result === 'notFound') toast(M[27])
    // 開いた会話を記録する（W-4）。メッセージ（開発計画書 1-4）までは、読んだメッセージの ID は 0
    if (typeof result === 'object') markRead(conversationId, 0).catch(() => {})
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
    setConversation(undefined)
    show(await load())
  }

  if (conversation === 'notFound') {
    // general も見られないとき（ワークスペースから外されたなど）は G-3 に戻す
    const general = workspace.generalConversationId
    return <Navigate to={conversationId === general ? '/' : conversationUrl(workspace.id, general)} replace />
  }

  return (
    <>
      <div className={styles.head}>
        {/* 画面の横幅が 600px 未満のときだけ出す（2.19） */}
        <button type="button" className={styles.back} aria-label="サイドバーに戻る" onClick={showSidebar}>←</button>
        {typeof conversation === 'object' && (
          <div className={styles.titles}>
            <h1 className={styles.name}>
              <span aria-hidden="true">{conversation.visibility === 'PRIVATE' ? '🔒 ' : '# '}</span>
              {conversation.name}
            </h1>
            {conversation.description && <p className={styles.description}>{conversation.description}</p>}
          </div>
        )}
        {typeof conversation === 'object' && (
          <span className={styles.members} aria-label={`メンバー ${conversation.memberCount} 人`}>
            👥 {conversation.memberCount}
          </span>
        )}
      </div>
      {conversation === 'failed' && (
        <div className={ui.empty}>
          <p>{M[48]}</p>
          <button type="button" className={ui.secondary} onClick={reload}>再読み込み</button>
        </div>
      )}
      {/* メッセージの一覧と入力欄は、メッセージ（開発計画書 1-4）で作る */}
      <div className={styles.messages} />
    </>
  )
}
