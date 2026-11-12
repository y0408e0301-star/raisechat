import { useState, type FormEvent } from 'react'
import { ApiError, createChannel, type ConversationDetail, type Visibility } from '../api'
import Dialog from '../components/Dialog'
import dialog from '../components/Dialog.module.css'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M } from '../messages'
import { CHANNEL_DESCRIPTION_MAX, channelNameInput, limitChars } from '../validation'
import styles from './ChannelDialogs.module.css'

type Props = {
  workspaceId: number
  onClose: () => void
  onCreated: (channel: ConversationDetail) => void
}

// G-13 チャンネルの作成ダイアログ（CH-2、画面設計書 15 章）。
// 名前の空白は入力したときに「-」に替えるので、空白を含む名前は送られない（API でも確かめる）
export default function CreateChannelDialog({ workspaceId, onClose, onCreated }: Props) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // 前後の「-」は空白を替えたもの。名前の空白はトリムする（FN-06 4 章）ので、送る前に外す
    const trimmed = name.replace(/^-+|-+$/g, '')
    if (!trimmed) {
      setError(M[24])
      return
    }
    setSending(true)
    try {
      onCreated(await createChannel(workspaceId, trimmed, description.trim(), visibility))
    } catch (err) {
      setSending(false)
      // 名前の誤り（M-24）と重なり（M-25）は入力欄の下に、それ以外はトーストで出す（画面設計書 2.4）
      if (err instanceof ApiError && err.field === 'name') setError(err.message)
      else toast(err instanceof ApiError ? err.message : M[49])
    }
  }

  return (
    <Dialog title="チャンネルを作る" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="channel-name" className={styles.label}>名前</label>
        <div className={`${styles.prefixed} ${error ? styles.invalid : ''}`}>
          <span aria-hidden="true" className={styles.prefix}>#</span>
          <input id="channel-name" className={styles.bare} data-autofocus value={name}
            onChange={(e) => {
              setName(channelNameInput(e.target.value))
              setError(null)
            }}
            aria-invalid={error ? true : undefined} aria-describedby={error ? 'channel-name-error' : undefined} />
        </div>
        {error && <p className={styles.error} id="channel-name-error">{error}</p>}

        <label htmlFor="channel-description" className={`${styles.label} ${styles.spaced}`}>説明（任意）</label>
        <input id="channel-description" className={styles.input} value={description}
          onChange={(e) => setDescription(limitChars(e.target.value, CHANNEL_DESCRIPTION_MAX))} />

        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>種類</legend>
          <label className={styles.radio}>
            <input type="radio" name="visibility" checked={visibility === 'PUBLIC'}
              onChange={() => setVisibility('PUBLIC')} />
            <span><strong>公開</strong>：ワークスペースの誰でも見て参加できます</span>
          </label>
          <label className={styles.radio}>
            <input type="radio" name="visibility" checked={visibility === 'PRIVATE'}
              onChange={() => setVisibility('PRIVATE')} />
            <span><strong>プライベート</strong>：招待された人だけが見られます</span>
          </label>
        </fieldset>

        <div className={dialog.actions}>
          <button type="button" className={ui.secondary} onClick={onClose}>キャンセル</button>
          <button type="submit" className={ui.primary} disabled={sending}>{sending ? '作成中…' : '作る'}</button>
        </div>
      </form>
    </Dialog>
  )
}
