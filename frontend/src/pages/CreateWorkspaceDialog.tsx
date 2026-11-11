import { useState, type FormEvent } from 'react'
import { ApiError, createWorkspace, type WorkspaceDetail } from '../api'
import Dialog from '../components/Dialog'
import dialog from '../components/Dialog.module.css'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M } from '../messages'
import { WORKSPACE_NAME_MAX, limitChars } from '../validation'
import styles from './CreateWorkspaceDialog.module.css'

type Props = {
  onClose: () => void
  onCreated: (workspace: WorkspaceDetail) => void
}

// G-12 ワークスペースの作成ダイアログ（W-3、画面設計書 14 章）
export default function CreateWorkspaceDialog({ onClose, onCreated }: Props) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError(M[11])
      return
    }
    setSending(true)
    try {
      onCreated(await createWorkspace(name.trim()))
    } catch (err) {
      setSending(false)
      // 名前の誤り（M-11）と上限（M-12）は入力欄の下に、それ以外はトーストで出す（画面設計書 2.4）
      if (err instanceof ApiError && (err.field === 'name' || err.code === 'WORKSPACE_LIMIT')) {
        setError(err.message)
      } else {
        toast(err instanceof ApiError ? err.message : M[49])
      }
    }
  }

  return (
    <Dialog title="ワークスペースを作る" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="workspace-name" className={styles.label}>名前</label>
        {/* 51 文字目（コードポイント）は入力できない（FN-03 4 章） */}
        <input id="workspace-name" className={`${styles.input} ${error ? styles.invalid : ''}`} data-autofocus
          value={name} onChange={(e) => {
            setName(limitChars(e.target.value, WORKSPACE_NAME_MAX))
            setError(null)
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'workspace-name-error' : 'workspace-name-hint'} />
        {error && <p className={styles.error} id="workspace-name-error">{error}</p>}
        <p className={styles.hint} id="workspace-name-hint">あなたがオーナーになります。友人は招待リンクで招待できます。</p>
        <div className={dialog.actions}>
          <button type="button" className={ui.secondary} onClick={onClose}>キャンセル</button>
          <button type="submit" className={ui.primary} disabled={sending}>{sending ? '作成中…' : '作る'}</button>
        </div>
      </form>
    </Dialog>
  )
}
