import type { KeyboardEvent, RefObject } from 'react'
import { M } from '../messages'
import { MESSAGE_MAX } from '../validation'
import { isSendable, messageLength } from './messageText'
import styles from './MessageInput.module.css'

// 残りがこの数より少なくなったら（本文が 3,800 文字を超えたら）残りの文字数を出す（MS-4）
const SHOW_REMAINING = 200

// 入力欄の高さは 10 行まで（画面設計書 2.14）。対応しているブラウザでは CSS の field-sizing で入力に合わせ、
// そうでないブラウザでも改行の数だけは高くする
const MAX_ROWS = 10

type Props = {
  value: string
  onChange: (value: string) => void
  // Enter キー（変換の確定を除く）
  onSubmit: () => void
  // Esc キー（編集のときだけ）
  onCancel?: () => void
  label: string
  placeholder?: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  autoFocus?: boolean
}

// メッセージの本文の入力欄（画面設計書 2.14）。送信の入力欄と、メッセージの編集（MS-9）で使う。
// 4,000 文字を超えても入力はでき（あとで削れるように）、超えている間は送れない（2.18）
export default function MessageInput({ value, onChange, onSubmit, onCancel, label, placeholder, textareaRef, autoFocus }: Props) {
  const length = messageLength(value)
  const remaining = MESSAGE_MAX - length

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape' && onCancel) {
      e.preventDefault()
      onCancel()
      return
    }
    // Enter で送り、Shift＋Enter で改行する。日本語の入力の変換を確定する Enter では送らない（MS-3・N-31）
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    if (isSendable(value)) onSubmit()
  }

  return (
    <div>
      <textarea ref={textareaRef} className={styles.textarea} rows={Math.min(MAX_ROWS, value.split('\n').length)} aria-label={label} placeholder={placeholder}
        // 「編集」を押した直後に、その入力欄で書き始められるようにする（MS-9）
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={handleKeyDown}
        aria-invalid={remaining < 0 ? true : undefined} />
      {remaining < SHOW_REMAINING && (
        <p className={`${styles.remaining} ${remaining < 0 ? styles.over : ''}`} aria-live="polite">
          {remaining < 0 ? <>{remaining} {M[35]}</> : `残り ${remaining}`}
        </p>
      )}
    </div>
  )
}
