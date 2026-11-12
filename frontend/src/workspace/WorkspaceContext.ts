import { useOutletContext } from 'react-router'
import type { ConversationSummary, WorkspaceDetail } from '../api'

// G-5 の枠（WorkspaceLayout）が、中の画面（会話・G-8 など）に渡すもの
export type WorkspaceContext = {
  workspace: WorkspaceDetail
  conversations: ConversationSummary[]
  // 画面の横幅が 600px 未満のとき、会話の「←」でサイドバーに戻る（画面設計書 2.19）
  showSidebar: () => void
  // サイドバーに足す・置き換える（参加した・作った）。通知（conversation.updated）より先に API の応答で反映する
  upsertConversation: (summary: ConversationSummary) => void
  // サイドバーから消す（退出した・削除した）
  removeConversation: (conversationId: number) => void
  // G-13 チャンネルの作成ダイアログを開く（サイドバーの「＋」・G-8 の「チャンネルを作る」）
  openCreateChannel: () => void
}

export function useWorkspace(): WorkspaceContext {
  return useOutletContext<WorkspaceContext>()
}
