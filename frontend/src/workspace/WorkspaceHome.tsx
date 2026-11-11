import { Navigate } from 'react-router'
import { conversationUrl } from '../api'
import { useWorkspace } from './WorkspaceContext'

// /w/{ws} を開いたとき（G-3 でワークスペースを選んだとき）。最後に開いた会話を開き、
// 初めてのとき・見られなくなっていたときは general を開く（W-4。見られるかは API が確かめる）
export default function WorkspaceHome() {
  const { workspace } = useWorkspace()
  const id = workspace.lastOpenedConversationId ?? workspace.generalConversationId
  return <Navigate to={conversationUrl(workspace.id, id)} replace />
}
