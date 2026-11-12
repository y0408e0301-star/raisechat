import { useState } from 'react'
import { M } from '../messages'
import Dialog from './Dialog'
import dialog from './Dialog.module.css'
import { useToast } from './ToastContext'
import ui from './ui.module.css'

type Props = {
  title: string
  message: string
  // 危険ボタンの文字（「削除」「退出」など）と、実行中の文字（「削除中…」など）
  action: string
  busy: string
  // 実行する。失敗したら閉じて M-49 を出す
  onConfirm: () => Promise<void>
  onClose: () => void
}

// G-18 確認ダイアログ（画面設計書 20 章）。左に「キャンセル」、右に危険ボタン。
// Enter キーで誤って実行しないよう、「キャンセル」にカーソルを置く（画面設計書 2.5）
export default function ConfirmDialog({ title, message, action, busy, onConfirm, onClose }: Props) {
  const toast = useToast()
  const [sending, setSending] = useState(false)

  async function handleConfirm() {
    setSending(true)
    try {
      await onConfirm()
    } catch {
      toast(M[49])
      onClose()
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <p>{message}</p>
      <div className={dialog.actions}>
        <button type="button" className={ui.secondary} onClick={onClose} data-autofocus>キャンセル</button>
        <button type="button" className={ui.danger} onClick={handleConfirm} disabled={sending}>
          {sending ? busy : action}
        </button>
      </div>
    </Dialog>
  )
}
