import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import styles from './Menu.module.css'

type Props = {
  // ボタンを読み上げるときの名前
  label: string
  // ボタンの中身（アバター・「▾」など）
  children: ReactNode
  buttonClassName?: string
  items: { label: string, to: string }[]
  // メニューを右端にそろえる（ヘッダーの右のボタン）
  alignRight?: boolean
}

// ボタンを押すと出るメニュー（ヘッダーの自分のアバター、サイドバーのワークスペースの名前。画面設計書 2.6・2.8）。
// 項目を選ぶ・Esc キー・メニューの外を押すと閉じる
export default function Menu({ label, children, buttonClassName, items, alignRight = false }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className={styles.root} ref={root}>
      <button ref={button} type="button" className={buttonClassName} aria-label={label} aria-expanded={open}
        aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        {children}
      </button>
      {open && (
        <ul className={`${styles.menu} ${alignRight ? styles.right : ''}`}>
          {items.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className={styles.item} onClick={() => setOpen(false)}>{item.label}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
