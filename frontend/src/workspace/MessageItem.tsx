import { Suspense, lazy, useEffect, useRef, useState, type PointerEvent } from 'react'
import { addReaction, ApiError, editMessage, removeReaction, type MessageView, type ReactionView } from '../api'
import AttachmentList from '../attachments/AttachmentList'
import attachmentStyles from '../attachments/Attachments.module.css'
import ImageViewer from '../attachments/ImageViewer'
import { useAuth } from '../auth/AuthContext'
import Avatar from '../components/Avatar'
import ProfileButton from '../profile/ProfileButton'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { formatFull, formatTime, formatUntil } from '../dates'
import MessageBody from '../markdown/MessageBody'
import { M } from '../messages'
import styles from './MessageItem.module.css'
import type { Entry } from './entries'
import MessageInput from './MessageInput'
import { isSendable, messageLength } from './messageText'
import { sameEmoji, toggled } from './reactionState'
import Reactions from './Reactions'

// 絵文字の一覧（emoji-picker-element）は大きいので、初めて開くときに読み込む
const EmojiPicker = lazy(() => import('../components/EmojiPicker'))

// 長押しとみなす時間と、指がこれ以上動いたら長押しにしない距離（px。スクロールと見分ける）
const LONG_PRESS_MS = 500
const LONG_PRESS_MOVE = 10

// メッセージの操作（画面設計書 2.9）。重ねたときの右上のアイコンと、長押しの下からのメニューで使う
type Action = 'リアクション' | 'スレッドで返信' | '編集' | '削除'
const ICONS: Record<Action, string> = { リアクション: '😀', スレッドで返信: '💬', 編集: '✎', 削除: '🗑' }

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
  // 添付が表示できなかった（署名付き URL の期限切れ。AT-10）
  onExpired: (messageId: number) => void
  // スレッドを開く（TH-1・TH-2）。スレッドのパネルの中では渡さない（返信への返信はできない。TH-5）
  onOpenThread?: (messageId: number) => void
  // リアクションが変わった（押してすぐの表示・API の応答・失敗して戻したとき。FN-10）
  onReactions: (messageId: number, reactions: ReactionView[]) => void
  // 送れる会話か。送れない会話では「リアクション」「スレッドで返信」を出さない（画面設計書 2.9）
  canPost?: boolean
  // 検索・メンション・通知から開いたメッセージ。背景を主色の薄い背景にし、3 秒かけて戻す（MS-14）
  highlighted?: boolean
}

// メッセージ（画面設計書 2.9）と添付（2.12）・リアクション（2.11）
export default function MessageItem({
  entry, compact, onDelete, onEdited, onGone, onRetry, onCancel, onExpired, onOpenThread, onReactions, canPost = true,
  highlighted = false,
}: Props) {
  const toast = useToast()
  const { me } = useAuth()
  const [editing, setEditing] = useState<string | null>(null)
  // 編集で残す添付の ID（AT-9。外すことだけができる）
  const [keep, setKeep] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  // G-17 で出している画像（画像の中の何番目か）
  const [viewing, setViewing] = useState<number | null>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  // 絵文字の一覧を出している（押したボタンの近くに出す。RE-1）
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)
  // API の応答を待っている絵文字。続けて押しても、応答が届くまでは送らない
  const reacting = useRef<string[]>([])
  // スマートフォンで長押しして、操作を下からのメニューで出している（画面設計書 2.9）
  const [sheet, setSheet] = useState(false)
  const press = useRef<{ timer: number, x: number, y: number } | null>(null)
  const article = useRef<HTMLElement>(null)

  useEffect(() => () => window.clearTimeout(press.current?.timer), [])
  useEffect(() => {
    if (!sheet) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSheet(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [sheet])

  const message = entry.kind === 'sent' ? entry.message : null
  const author = entry.kind === 'sent' ? entry.message.author : entry.author
  const body = entry.kind === 'sent' ? entry.message.body : entry.body
  const createdAt = entry.kind === 'sent' ? entry.message.createdAt : entry.createdAt
  const attachments = entry.kind === 'sent' ? entry.message.attachments : entry.attachments
  const deleted = message?.deleted ?? false
  // 参加していない公開チャンネル・相手がいない DM・「削除されました」には付けられない（RE-7）
  const canReact = message !== null && !deleted && canPost
  // 自分へのメンションを含む（MN-3。左の線と背景で目立たせる）
  const mentionsMe = message?.mentions.some((m) => m.username === me?.username) ?? false
  // 本文が空でも、添付が残れば保存できる
  const savable = editing !== null && (isSendable(editing) || (messageLength(editing) === 0 && keep.length > 0))

  function startEditing() {
    if (!message) return
    setEditing(message.body)
    setKeep(message.attachments.map((a) => a.id))
  }

  async function save() {
    if (!message || editing === null || !savable) return
    setSaving(true)
    try {
      onEdited(await editMessage(message.id, editing.trim(), keep))
      setEditing(null)
    } catch (e) {
      // 失敗したら M-49 を出す。もうなければ一覧から消す（FN-07 9 章）
      toast(M[49])
      if (e instanceof ApiError && e.status === 404) onGone(message.id)
    } finally {
      setSaving(false)
    }
  }

  // 付ける・外す（RE-1・RE-3）。すぐに表示を変え、失敗したら戻して M-49（種類の上限なら M-42）を出す
  async function react(emoji: string, on: boolean) {
    if (!message || !me || reacting.current.some((e) => sameEmoji(e, emoji))) return
    reacting.current = [...reacting.current, emoji]
    const before = message.reactions
    onReactions(message.id, toggled(before, emoji, me, on))
    try {
      onReactions(message.id, await (on ? addReaction : removeReaction)(message.id, emoji))
    } catch (e) {
      onReactions(message.id, before)
      toast(e instanceof ApiError && e.code === 'REACTION_LIMIT' ? e.message : M[49])
    } finally {
      reacting.current = reacting.current.filter((e) => e !== emoji)
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

  // 指で長押ししたら、操作を下からのメニューで出す。指が動いた（スクロールした）・離したときはやめる
  function startPress(e: PointerEvent<HTMLElement>) {
    if (e.pointerType !== 'touch') return
    window.clearTimeout(press.current?.timer)
    press.current = { timer: window.setTimeout(() => setSheet(true), LONG_PRESS_MS), x: e.clientX, y: e.clientY }
  }
  function movePress(e: PointerEvent<HTMLElement>) {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > LONG_PRESS_MOVE) endPress()
  }
  function endPress() {
    window.clearTimeout(press.current?.timer)
    press.current = null
  }

  // 操作を押したら、下からのメニューは閉じる。絵文字の一覧は、メニューから開いたときはメッセージの近くに出す
  function act(action: Action, button: HTMLElement) {
    if (!message) return
    setSheet(false)
    if (action === 'リアクション') setPickerAnchor(sheet ? article.current : button)
    if (action === 'スレッドで返信') onOpenThread?.(message.id)
    if (action === '編集') startEditing()
    if (action === '削除') onDelete(message)
  }

  const actions: Action[] = message && !deleted && editing === null
    ? [
        ...(canReact ? ['リアクション' as const] : []),
        ...(onOpenThread && canPost ? ['スレッドで返信' as const] : []),
        ...(message.mine ? ['編集' as const] : []),
        ...(message.canDelete ? ['削除' as const] : []),
      ]
    : []

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 長押しはタッチだけの近道。操作はボタンでもできる
    <article ref={article} onPointerDown={startPress} onPointerMove={movePress} onPointerUp={endPress}
      // 長押しで出るブラウザのメニューは出さない（Android の Chrome は長押しで contextmenu を出す）
      onPointerCancel={endPress} onContextMenu={(e) => { if (press.current || sheet) e.preventDefault() }}
      className={`${styles.message} ${sheet ? styles.sheet : ''} ${compact ? styles.compact : ''} ${entry.kind === 'pending' && !entry.failed ? styles.sending : ''} ${mentionsMe ? styles.toMe : ''} ${highlighted ? styles.highlight : ''}`}
      data-message-id={message?.id}
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
                  label="メッセージを編集" textareaRef={editor} autoFocus conversationId={message?.conversationId} />
                {attachments.some((a) => keep.includes(a.id)) && (
                  // 添付は「×」で外せる（足すことはできない。AT-9）
                  <ul className={attachmentStyles.previews} aria-label="添付">
                    {attachments.filter((a) => keep.includes(a.id)).map((a) => (
                      <li key={a.id} className={attachmentStyles.preview}>
                        {a.kind === 'IMAGE'
                          ? <img src={a.thumbnailUrl ?? a.url} alt={a.fileName} className={attachmentStyles.previewImage} />
                          : <span className={attachmentStyles.previewName} title={a.fileName}>▶ {a.fileName}</span>}
                        <button type="button" className={attachmentStyles.remove} aria-label={`${a.fileName}を外す`}
                          title="外す" onClick={() => setKeep((ids) => ids.filter((id) => id !== a.id))}>×</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className={styles.editorActions}>
                  <span className={styles.hint}>Esc でキャンセル・Enter で保存</span>
                  <button type="button" className={ui.secondary} onClick={() => setEditing(null)}>キャンセル</button>
                  <button type="button" className={ui.primary} onClick={save} disabled={saving || !savable}>
                    保存
                  </button>
                </div>
              </div>
            )
            : (
              <>
                {body && <MessageBody body={body} mentions={message?.mentions} me={me?.username} />}
                {attachments.length > 0 && (
                  <AttachmentList attachments={attachments} onOpenImage={setViewing}
                    onExpired={() => { if (message) onExpired(message.id) }} />
                )}
              </>
            )}
        {compact && editing === null && edited}
        {message && !deleted && editing === null && (
          <Reactions reactions={message.reactions} canReact={canReact} onOpenPicker={setPickerAnchor}
            onToggle={(emoji) => react(emoji, !message.reactions.find((r) => r.emoji === emoji)?.reactedByMe)} />
        )}
        {message && onOpenThread && message.replyCount > 0 && (
          // 返信の件数（TH-2）：返信した人のアバター（最大 3 人）・「（件数）件の返信」・最後の返信の時刻
          <button type="button" className={styles.replies} onClick={() => onOpenThread(message.id)}>
            <span className={styles.replyUsers} aria-hidden="true">
              {message.replyUsers.map((u) => (
                <Avatar key={u.username} displayName={u.displayName} avatarUrl={u.avatarUrl} size={20} />
              ))}
            </span>
            <span className={styles.replyCount}>{message.replyCount} 件の返信</span>
            {message.lastReplyAt && <span className={styles.replyLast}>最終 {formatUntil(message.lastReplyAt)}</span>}
          </button>
        )}
        {entry.kind === 'pending' && entry.failed && (
          // 送れなかったとき（MS-13）
          <p className={styles.failed} role="alert">
            {M[34]}
            <button type="button" className={styles.link} onClick={() => onRetry(entry.clientId)}>もう一度送る</button>
            <button type="button" className={styles.link} onClick={() => onCancel(entry.clientId)}>取り消す</button>
          </p>
        )}
      </div>
      {actions.length > 0 && (
        // 操作（RE-1・TH-1・MS-9・MS-10）。マウスではメッセージに重ねたとき右上に、スマートフォンでは長押しで下から出す
        <>
          {sheet && <div className={styles.sheetBackdrop} aria-hidden="true" onClick={() => setSheet(false)} />}
          <div className={styles.actions}>
            {actions.map((action) => (
              <button key={action} type="button" className={styles.action} aria-label={action} title={action}
                onClick={(e) => act(action, e.currentTarget)}>
                <span aria-hidden="true">{ICONS[action]}</span>
                <span className={styles.actionLabel} aria-hidden="true">{action}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {pickerAnchor && (
        <Suspense fallback={null}>
          <EmojiPicker anchor={pickerAnchor} onClose={() => setPickerAnchor(null)}
            onSelect={(emoji) => { setPickerAnchor(null); void react(emoji, true) }} />
        </Suspense>
      )}
      {viewing !== null && (
        <ImageViewer images={attachments.filter((a) => a.kind === 'IMAGE')} start={viewing}
          onClose={() => setViewing(null)} />
      )}
    </article>
  )
}
