import { useOutletContext } from 'react-router'
import type { ConversationSummary, WorkspaceDetail } from '../api'

// G-5 の枠（WorkspaceLayout）が、中の画面（会話など）に渡すもの
export type WorkspaceContext = {
  workspace: WorkspaceDetail
  conversations: ConversationSummary[]
  // 画面の横幅が 600px 未満のとき、会話の「←」でサイドバーに戻る（画面設計書 2.19）
  showSidebar: () => void
}

export function useWorkspace(): WorkspaceContext {
  return useOutletContext<WorkspaceContext>()
}
