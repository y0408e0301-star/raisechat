import { useRef, useState } from 'react'
import { ApiError, editMessage, type MessageView } from '../api'
import Avatar from '../components/Avatar'
import ProfileButton from '../profile/ProfileButton'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { formatFull, formatTime } from '../dates'
import MessageBody from '../markdown/MessageBody'
import { M } from '../messages'
import styles from './MessageItem.module.css'
import type { Entry } from './entries'
import MessageInput from './MessageInput'
import { isSendable } from './messageText'

type Props = {
  entry: Entry
  // 同じ人が 5 分以内に続けて送ったもの。アバターと表示名を省く（MS-12）
  compact: boolean
  onDelete: (message: MessageView) => void
  onEdited: (message: MessageView) => void
  // 編集しようとしたメッセージがもうなかったとき
  onGone: (messageId: number) => void
  onRetry: (clientId: string) => void
  onCancel: (clientId: string) => void
}

// メッセージ（画面設計書 2.9）。リアクション・スレッド・添付は、それぞれの段階（1-11〜1-13）で足す
export default function MessageItem({ entry, compact, onDelete, onEdited, onGone, onRetry, onCancel }: Props) {
  const toast = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const editor = useRef<HTMLTextAreaElement>(null)

  const message = entry.kind === 'sent' ? entry.message : null
  const author = entry.kind === 'sent' ? entry.message.author : entry.author
  const body = entry.kind === 'sent' ? entry.message.body : entry.body
  const createdAt = entry.kind === 'sent' ? entry.message.createdAt : entry.createdAt
  const deleted = message?.deleted ?? false

  async function save() {
    if (!message || editing === null || !isSendable(editing)) return
    setSaving(true)
    try {
      onEdited(await editMessage(message.id, editing.trim()))
      setEditing(null)
    } catch (e) {
      // 失敗したら M-49 を出す。もうなければ一覧から消す（FN-07 9 章）
      toast(M[49])
      if (e instanceof ApiError && e.status === 404) onGone(message.id)
    } finally {
      setSaving(false)
    }
  }

  const time = entry.kind === 'pending'
    ? (entry.failed ? null : <span className={styles.time}>送信中…</span>)
    : (
      <span className={styles.time}>
        <time dateTime={createdAt} title={formatFull(createdAt)}>{formatTime(createdAt)}</time>
      </span>
    )
  // 編集したメッセージは時刻の後ろに出す（MS-9）。時刻を隠す続けたメッセージでは、本文の後ろに出す
  const edited = message?.editedAt && !deleted ? <span className={styles.edited}>（編集済み）</span> : null

  return (
    <article className={`${styles.message} ${compact ? styles.compact : ''} ${entry.kind === 'pending' && !entry.failed ? styles.sending : ''}`}
      aria-label={`${author.displayName}のメッセージ`}>
      <div className={styles.side}>
        {compact
          ? time
          : deleted
            ? <span className={styles.deletedAvatar} />
            : (
              <ProfileButton user={author} label={`${author.displayName}のプロフィール`}>
                <Avatar displayName={author.displayName} avatarUrl={author.avatarUrl} size={36} />
              </ProfileButton>
            )}
      </div>
      <div className={styles.main}>
        {!compact && (
          <div className={styles.header}>
            {!deleted && (
              <ProfileButton user={author}>
                <span className={styles.name}>{author.displayName}</span>
              </ProfileButton>
            )}
            {/* 重ねるとステータスの文を出す（画面設計書 2.7） */}
            {author.statusEmoji && !deleted && (
              <span className={styles.status} title={author.statusText ?? undefined}>{author.statusEmoji}</span>
            )}
            {time}
            {edited}
          </div>
        )}
        {deleted
          ? <p className={styles.deletedText}>{M[33]}</p>
          : editing !== null
            ? (
              <div className={styles.editor}>
                <MessageInput value={editing} onChange={setEditing} onSubmit={save} onCancel={() => setEditing(null)}
                  label="メッセージを編集" textareaRef={editor} autoFocus />
                <div className={styles.editorActions}>
                  <span className={styles.hint}>Esc でキャンセル・Enter で保存</span>
                  <button type="button" className={ui.secondary} onClick={() => setEditing(null)}>キャンセル</button>
                  <button type="button" className={ui.primary} onClick={save} disabled={saving || !isSendable(editing)}>
                    保存
                  </button>
                </div>
              </div>
            )
            : <MessageBody body={body} />}
        {compact && editing === null && edited}
        {entry.kind === 'pending' && entry.failed && (
          // 送れなかったとき（MS-13）
          <p className={styles.failed} role="alert">
            {M[34]}
            <button type="button" className={styles.link} onClick={() => onRetry(entry.clientId)}>もう一度送る</button>
            <button type="button" className={styles.link} onClick={() => onCancel(entry.clientId)}>取り消す</button>
          </p>
        )}
      </div>
      {message && !deleted && editing === null && (message.mine || message.canDelete) && (
        // メッセージに重ねたときに出す操作（MS-9・MS-10）
        <div className={styles.actions}>
          {message.mine && (
            <button type="button" className={styles.action} aria-label="編集" title="編集"
              onClick={() => setEditing(message.body)}>✎</button>
          )}
          {message.canDelete && (
            <button type="button" className={styles.action} aria-label="削除" title="削除"
              onClick={() => onDelete(message)}>🗑</button>
          )}
        </div>
      )}
    </article>
  )
}
