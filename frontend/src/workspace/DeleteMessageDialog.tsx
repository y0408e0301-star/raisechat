import { useState } from 'react'
import { ApiError, deleteMessage, type MessageView } from '../api'
import Dialog from '../components/Dialog'
import dialog from '../components/Dialog.module.css'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M, M32 } from '../messages'

type Props = {
  message: MessageView
  onClose: () => void
  // 消したとき。データごと消したら null、「削除されました」にしたらそのメッセージ（MS-11）
  onDeleted: (result: MessageView | null) => void
  // もうなかったとき（ほかの画面で消されたなど）。一覧から消す
  onGone: () => void
}

// G-18 確認ダイアログ（メッセージの削除。MS-10、画面設計書 20 章）。
// 自分のメッセージは M-31、オーナーがほかの人のメッセージを消すときは M-32
export default function DeleteMessageDialog({ message, onClose, onDeleted, onGone }: Props) {
  const toast = useToast()
  const [sending, setSending] = useState(false)

  async function handleDelete() {
    setSending(true)
    try {
      onDeleted(await deleteMessage(message.id))
    } catch (e) {
      // 失敗したら閉じて M-49 を出す（画面設計書 20 章）
      toast(M[49])
      if (e instanceof ApiError && e.status === 404) onGone()
      else onClose()
    }
  }

  return (
    <Dialog title="メッセージの削除" onClose={onClose}>
      <p>{message.mine ? M[31] : M32(message.author.displayName)}</p>
      <div className={dialog.actions}>
        {/* Enter キーで誤って消さないよう、「キャンセル」にカーソルを置く（画面設計書 2.5） */}
        <button type="button" className={ui.secondary} onClick={onClose} data-autofocus>キャンセル</button>
        <button type="button" className={ui.danger} onClick={handleDelete} disabled={sending}>
          {sending ? '削除中…' : '削除'}
        </button>
      </div>
    </Dialog>
  )
}
