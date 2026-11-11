import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import styles from './Dialog.module.css'

type Props = {
  title: string
  // 「キャンセル」「閉じる」と同じ動き。Esc キーと覆いの部分のクリックでも呼ぶ
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

// ダイアログ共通（画面設計書 2.5）。画面の中央に出し、後ろの画面を覆って操作できなくする。
// 開いている間は Tab キーでダイアログの外に出ない。閉じたら、開く前にカーソルがあった場所に戻す。
// 最初にカーソルを置く場所は、中の入力欄・ボタンに data-autofocus を付けて決める
export default function Dialog({ title, onClose, children }: Props) {
  const titleId = useId()
  const panel = useRef<HTMLDialogElement>(null)
  // 開いた後に onClose が替わっても、キーの処理を付け直さない
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])

  // 開く前にカーソルがあった場所。autoFocus で中の部品に移る前（最初の描画のとき）に覚える
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))

  useEffect(() => {
    // data-autofocus の付いた部品、なければダイアログそのものにカーソルを置く。
    // autoFocus は使わない（開発中の StrictMode で effect が 2 回動くと、後始末で開く前の場所に戻ってしまうため）
    const initial = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current
    initial?.focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      opener?.focus()
    }
  }, [opener])

  return (
    // 覆いの部分のクリックは、マウスで押したときだけ閉じる（キーボードでは Esc キーで閉じる）
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <dialog ref={panel} open className={styles.panel} aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className={styles.title}>{title}</h2>
        {children}
      </dialog>
    </div>
  )
}
