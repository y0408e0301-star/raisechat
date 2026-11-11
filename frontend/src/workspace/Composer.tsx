import { useLayoutEffect, useRef } from 'react'
import MessageInput from './MessageInput'
import { isSendable } from './messageText'
import styles from './Composer.module.css'

type Props = {
  value: string
  onChange: (value: string) => void
  onSend: (body: string) => void
  // 薄い文字で出す説明（「# general へのメッセージ」）
  placeholder: string
}

// 選んだ文字の前後に入れる記号（MS-8）
const MARKS = [
  { label: '太字', text: 'B', mark: '**' },
  { label: '斜体', text: 'I', mark: '*' },
  { label: '取り消し線', text: 'S', mark: '~~' },
  { label: 'コード', text: '</>', mark: '`' },
] as const

// G-5 の入力欄（画面設計書 2.14）。📎（添付）は 1-11、😀（絵文字）は 1-13 で足す
export default function Composer({ value, onChange, onSend, placeholder }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  // 記号を入れた後に選ぶ範囲。描き直した後で入力欄に反映する
  const selection = useRef<[number, number] | null>(null)

  useLayoutEffect(() => {
    if (!selection.current || !textarea.current) return
    textarea.current.setSelectionRange(...selection.current)
    selection.current = null
  })

  function send() {
    if (!isSendable(value)) return
    onSend(value.trim())
    textarea.current?.focus()
  }

  // 選んだ文字の前後に記号を入れる。何も選んでいなければ記号を入れて、その間にカーソルを置く（MS-8）
  function wrap(mark: string) {
    const el = textarea.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    onChange(value.slice(0, start) + mark + value.slice(start, end) + mark + value.slice(end))
    selection.current = [start + mark.length, end + mark.length]
    el.focus()
  }

  return (
    <div className={styles.composer}>
      <MessageInput value={value} onChange={onChange} onSubmit={send} label="メッセージ" placeholder={placeholder}
        textareaRef={textarea} />
      <div className={styles.toolbar}>
        {MARKS.map((m) => (
          // ボタンを押しても入力欄の選んだ範囲が外れないよう、マウスを押したときにカーソルを動かさない
          <button key={m.label} type="button" className={styles.icon} aria-label={m.label} title={m.label}
            onMouseDown={(e) => e.preventDefault()} onClick={() => wrap(m.mark)}>
            {m.text}
          </button>
        ))}
        <button type="button" className={styles.send} onClick={send} disabled={!isSendable(value)}>送信 ➤</button>
      </div>
    </div>
  )
}
