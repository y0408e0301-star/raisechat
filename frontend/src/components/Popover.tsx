import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './Popover.module.css'

// 画面の端・押したものとの間をあける
const GAP = 8

type Props = {
  // 押したもの。この近くに出し、閉じたらここにカーソルを戻す
  anchor: HTMLElement | null
  // 読み上げるときの名前
  label: string
  width: number
  // 吹き出しの中の余白などを変えるとき
  className?: string
  onClose: () => void
  children: ReactNode
}

// 押した場所の近くに出す吹き出し（G-16 プロフィール・絵文字の一覧。画面設計書 2.15・18 章）。
// 押したものの下（入らなければ上）に出し、Esc キーか外側を押すと閉じる。
// 画面の横幅が 600px 未満のときは、ダイアログ（2.5）と同じく下から横幅いっぱいに出す（CSS で切り替える）
export default function Popover({ anchor, label, width, className, onClose, children }: Props) {
  const panel = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])

  // 描いた後の高さで、下に入るか決める。位置は描き直さずに、要素に直接書く。
  // 中身が後から増える（絵文字の一覧・読み込んだプロフィール）ので、大きさが変わるたびに決め直す
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    function place(target: HTMLElement) {
      const rect = anchor?.getBoundingClientRect()
      const left = rect ? Math.max(GAP, Math.min(rect.left, window.innerWidth - width - GAP)) : GAP
      const below = rect ? rect.bottom + GAP : GAP
      const top = !rect || below + target.offsetHeight <= window.innerHeight - GAP
        ? below
        : Math.max(GAP, rect.top - target.offsetHeight - GAP)
      target.style.top = `${top}px`
      target.style.left = `${left}px`
      target.style.visibility = 'visible'
    }
    place(el)
    // jsdom には ResizeObserver がない
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => place(el))
    observer.observe(el)
    return () => observer.disconnect()
  }, [anchor, width])

  useEffect(() => {
    const initial = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current
    initial?.focus()
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      anchor?.focus()
    }
  }, [anchor])

  return createPortal(
    // 外側はマウスで押したときだけ閉じる（キーボードでは Esc キーで閉じる）
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <dialog ref={panel} open aria-label={label} tabIndex={-1} className={`${styles.panel} ${className ?? ''}`}
        style={{ width, visibility: 'hidden' }}>
        {children}
      </dialog>
    </div>,
    document.body,
  )
}
