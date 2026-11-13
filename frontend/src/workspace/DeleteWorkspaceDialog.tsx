import { useId, useState } from 'react'
import { deleteWorkspace, type WorkspaceDetail } from '../api'
import Dialog from '../components/Dialog'
import dialog from '../components/Dialog.module.css'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M, M14 } from '../messages'
import { WORKSPACE_NAME_MAX, limitChars } from '../validation'
import styles from './ChannelDialogs.module.css'

type Props = {
  workspace: WorkspaceDetail
  onClose: () => void
  onDeleted: () => void
}

// G-18 確認ダイアログ（ワークスペースの削除。W-6、画面設計書 20 章）。
// 名前の入力欄にワークスペースの名前と同じ文字を入れたときだけ「削除」を押せる
export default function DeleteWorkspaceDialog({ workspace, onClose, onDeleted }: Props) {
  const toast = useToast()
  const inputId = useId()
  const [name, setName] = useState('')
  const [sending, setSending] = useState(false)

  async function handleDelete() {
    setSending(true)
    try {
      await deleteWorkspace(workspace.id, name)
      onDeleted()
    } catch {
      toast(M[49])
      onClose()
    }
  }

  return (
    <Dialog title="ワークスペースの削除" onClose={onClose}>
      <p>{M14(workspace.name)}</p>
      <label htmlFor={inputId} className={styles.label}>ワークスペースの名前</label>
      <input id={inputId} className={styles.input} value={name} autoComplete="off" data-autofocus
        onChange={(e) => setName(limitChars(e.target.value, WORKSPACE_NAME_MAX))} />
      <div className={dialog.actions}>
        <button type="button" className={ui.secondary} onClick={onClose}>キャンセル</button>
        <button type="button" className={ui.danger} onClick={handleDelete} disabled={name !== workspace.name || sending}>
          {sending ? '削除中…' : '削除'}
        </button>
      </div>
    </Dialog>
  )
}
