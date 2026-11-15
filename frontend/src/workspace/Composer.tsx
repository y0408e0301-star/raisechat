import { Suspense, lazy, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react'
import type { AttachmentView } from '../api'
import UploadPreviews from '../attachments/UploadPreviews'
import { ACCEPT, type Uploads } from '../attachments/uploads'
import MessageInput from './MessageInput'
import { isSendable, messageLength } from './messageText'
import styles from './Composer.module.css'

// 絵文字の一覧（emoji-picker-element）は大きいので、初めて開くときに読み込む
const EmojiPicker = lazy(() => import('../components/EmojiPicker'))

type Props = {
  value: string
  onChange: (value: string) => void
  onSend: (body: string, attachments: AttachmentView[]) => void
  // 薄い文字で出す説明（「# general へのメッセージ」）
  placeholder: string
  // 添付（FN-09）。ドラッグ＆ドロップは会話の画面全体で受けるので、ConversationPage が持つ
  uploads: Uploads
  // 送る先の会話（メンションの候補に使う。MN-1）
  conversationId: number
}

// 選んだ文字の前後に入れる記号（MS-8）
const MARKS = [
  { label: '太字', text: 'B', mark: '**' },
  { label: '斜体', text: 'I', mark: '*' },
  { label: '取り消し線', text: 'S', mark: '~~' },
  { label: 'コード', text: '</>', mark: '`' },
] as const

// G-5 の入力欄（画面設計書 2.14）
export default function Composer({ value, onChange, onSend, placeholder, uploads, conversationId }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // 記号を入れた後に選ぶ範囲。描き直した後で入力欄に反映する
  const selection = useRef<[number, number] | null>(null)
  // 絵文字の一覧を出している（押した 😀）と、絵文字を入れる範囲（一覧を開いたときに選んでいた範囲）
  const [picker, setPicker] = useState<{ anchor: HTMLElement, range: [number, number] } | null>(null)

  useLayoutEffect(() => {
    if (!selection.current || !textarea.current) return
    textarea.current.setSelectionRange(...selection.current)
    selection.current = null
  })

  // 本文があるか、添付があれば送れる。アップロード中・失敗したものがあるときは送れない（MS-3・AT-3・AT-4）
  const sendable = !uploads.busy && (isSendable(value) || (messageLength(value) === 0 && uploads.readyCount > 0))

  function send() {
    if (!sendable) return
    onSend(value.trim(), uploads.take())
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

  // 選んだ絵文字をカーソルの位置に入れる（選んでいた文字は置き換える。画面設計書 2.14）
  function insertEmoji(emoji: string) {
    if (!picker) return
    const [start, end] = picker.range
    onChange(value.slice(0, start) + emoji + value.slice(end))
    selection.current = [start + emoji.length, start + emoji.length]
    setPicker(null)
    // 一覧は閉じるときに 😀 にフォーカスを戻すので、その後で入力欄に戻す
    window.setTimeout(() => textarea.current?.focus())
  }

  // 画像を貼り付けたら添付する（AT-1）。文字の貼り付けはそのまま入力欄に入れる
  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(e.clipboardData.files)
    if (files.length === 0) return
    e.preventDefault()
    uploads.add(files)
  }

  return (
    <div className={styles.composer} onPaste={handlePaste}>
      <UploadPreviews uploads={uploads.uploads} onRetry={uploads.retry} onRemove={uploads.remove} />
      <MessageInput value={value} onChange={onChange} onSubmit={send} label="メッセージ" placeholder={placeholder}
        textareaRef={textarea} conversationId={conversationId} />
      <div className={styles.toolbar}>
        <button type="button" className={styles.icon} aria-label="ファイルを添付" title="ファイルを添付"
          onClick={() => fileInput.current?.click()}>📎</button>
        <input ref={fileInput} type="file" accept={ACCEPT} multiple className={styles.file} tabIndex={-1}
          aria-hidden="true" onChange={(e) => {
            uploads.add(Array.from(e.target.files ?? []))
            // 同じファイルをもう一度選べるよう、選んだものを空にする
            e.target.value = ''
          }} />
        {MARKS.map((m) => (
          // ボタンを押しても入力欄の選んだ範囲が外れないよう、マウスを押したときにカーソルを動かさない
          <button key={m.label} type="button" className={styles.icon} aria-label={m.label} title={m.label}
            onMouseDown={(e) => e.preventDefault()} onClick={() => wrap(m.mark)}>
            {m.text}
          </button>
        ))}
        <button type="button" className={styles.icon} aria-label="絵文字" title="絵文字"
          onClick={(e) => {
            const el = textarea.current
            setPicker({ anchor: e.currentTarget, range: el ? [el.selectionStart, el.selectionEnd] : [value.length, value.length] })
          }}>😀</button>
        <button type="button" className={styles.send} onClick={send} disabled={!sendable}>送信 ➤</button>
      </div>
      {picker && (
        <Suspense fallback={null}>
          <EmojiPicker anchor={picker.anchor} onClose={() => setPicker(null)} onSelect={insertEmoji} />
        </Suspense>
      )}
    </div>
  )
}
