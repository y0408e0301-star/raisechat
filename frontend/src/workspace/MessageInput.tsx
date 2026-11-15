import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import Avatar from '../components/Avatar'
import { M } from '../messages'
import { MESSAGE_MAX } from '../validation'
import { insertMention, mentionQuery, useMentionCandidates } from './mentionSuggest'
import { messageLength } from './messageText'
import styles from './MessageInput.module.css'

// 残りがこの数より少なくなったら（本文が 3,800 文字を超えたら）残りの文字数を出す（MS-4）
const SHOW_REMAINING = 200

// 入力欄の高さは 10 行まで（画面設計書 2.14）。対応しているブラウザでは CSS の field-sizing で入力に合わせ、
// そうでないブラウザでも改行の数だけは高くする
const MAX_ROWS = 10

type Props = {
  value: string
  onChange: (value: string) => void
  // Enter キー（変換の確定を除く）。送れるか（本文・添付があるか）は呼ぶ側が確かめる
  onSubmit: () => void
  // Esc キー（編集のときだけ）
  onCancel?: () => void
  label: string
  placeholder?: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  autoFocus?: boolean
  // 送る先の会話。渡すと「@」でメンションの候補を出す（MN-1）
  conversationId?: number
}

// メッセージの本文の入力欄（画面設計書 2.14）。送信の入力欄と、メッセージの編集（MS-9）で使う。
// 4,000 文字を超えても入力はでき（あとで削れるように）、超えている間は送れない（2.18）
export default function MessageInput({
  value, onChange, onSubmit, onCancel, label, placeholder, textareaRef, autoFocus, conversationId,
}: Props) {
  const length = messageLength(value)
  const remaining = MESSAGE_MAX - length
  const listId = useId()
  // 入力の位置。「@」の後を打っているかを知るのに使う
  const [caret, setCaret] = useState(value.length)
  const [active, setActive] = useState(0)
  // Esc で閉じた「@」の位置。同じ「@」の後を打つ間は出さない
  const [dismissed, setDismissed] = useState<number | null>(null)
  // 候補を入れた後に動かす入力の位置
  const nextCaret = useRef<number | null>(null)

  const query = conversationId === undefined ? null : mentionQuery(value, caret)
  const candidates = useMentionCandidates(conversationId, query?.start ?? null, query?.text ?? null)
  const open = query !== null && query.start !== dismissed && candidates.length > 0
  const selected = Math.min(active, candidates.length - 1)

  // 描き直した後で入力欄に反映する
  useLayoutEffect(() => {
    if (nextCaret.current === null) return
    textareaRef.current?.setSelectionRange(nextCaret.current, nextCaret.current)
    nextCaret.current = null
  })

  function choose(username: string) {
    if (!query) return
    const inserted = insertMention(value, caret, query.start, username)
    nextCaret.current = inserted.caret
    setCaret(inserted.caret)
    setActive(0)
    onChange(inserted.value)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const composing = e.nativeEvent.isComposing || e.keyCode === 229
    // 候補を出しているとき：上下の矢印で選び、Enter・Tab で入れ、Esc で閉じる（MN-1）
    if (open && !composing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((selected + step + candidates.length) % candidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        choose(candidates[selected].user.username)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(query.start)
        return
      }
    }
    if (e.key === 'Escape' && onCancel) {
      e.preventDefault()
      onCancel()
      return
    }
    // Enter で送り、Shift＋Enter で改行する。日本語の入力の変換を確定する Enter では送らない（MS-3・N-31）
    if (e.key !== 'Enter' || e.shiftKey || composing) return
    e.preventDefault()
    onSubmit()
  }

  return (
    <div className={styles.wrap}>
      {open && (
        // メンションの候補（画面設計書 2.16）。入力欄の上に出す。キーボードでは入力欄から選ぶ（aria-activedescendant）。
        // 見た目を決めるため select・datalist ではなく listbox・option の役割を付ける
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role
        <ul id={listId} role="listbox" aria-label="メンションの候補" className={styles.candidates}>
          {candidates.map((c, i) => (
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events
            <li key={c.user.username} id={`${listId}-${i}`} role="option" aria-selected={i === selected}
              className={`${styles.candidate} ${i === selected ? styles.selected : ''}`}
              // 押しても入力欄からフォーカスを外さない
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(c.user.username)}>
              <Avatar displayName={c.user.displayName} avatarUrl={c.user.avatarUrl} size={32} />
              <span className={styles.candidateName}>{c.user.displayName}</span>
              <span className={styles.candidateSub}>@{c.user.username}</span>
              {!c.member && <span className={styles.candidateNote}>チャンネルにいません</span>}
            </li>
          ))}
        </ul>
      )}
      <textarea ref={textareaRef} className={styles.textarea} rows={Math.min(MAX_ROWS, value.split('\n').length)} aria-label={label} placeholder={placeholder}
        // 「編集」を押した直後に、その入力欄で書き始められるようにする（MS-9）
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          setCaret(e.target.selectionStart)
          onChange(e.target.value)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={handleKeyDown}
        aria-autocomplete={conversationId === undefined ? undefined : 'list'}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${selected}` : undefined}
        aria-invalid={remaining < 0 ? true : undefined} />
      {remaining < SHOW_REMAINING && (
        <p className={`${styles.remaining} ${remaining < 0 ? styles.over : ''}`} aria-live="polite">
          {remaining < 0 ? <>{remaining} {M[35]}</> : `残り ${remaining}`}
        </p>
      )}
    </div>
  )
}
