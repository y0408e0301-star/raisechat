import { Navigate } from 'react-router'
import { conversationPath, conversationUrl } from '../api'
import { useWorkspace } from './WorkspaceContext'

// /w/{ws} を開いたとき（G-3 でワークスペースを選んだとき）。最後に開いた会話を開き、
// 初めてのとき・見られなくなっていたときは general を開く（W-4。見られるかは API が確かめる）
export default function WorkspaceHome() {
  const { workspace, conversations } = useWorkspace()
  const id = workspace.lastOpenedConversationId ?? workspace.generalConversationId
  // 最後に開いたのが DM なら DM の URL にする
  const opened = conversations.find((c) => c.id === id)
  return <Navigate to={opened ? conversationPath(opened) : conversationUrl(workspace.id, id)} replace />
}
