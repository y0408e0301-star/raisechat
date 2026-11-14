import { useEffect, useId, useRef, useState } from 'react'
import type { AttachmentView } from '../api'
import styles from './Attachments.module.css'

type Props = {
  images: AttachmentView[]
  // はじめに出す画像
  start: number
  onClose: () => void
}

// G-17 画像の拡大ダイアログ（画面設計書 19 章、AT-5・AT-6）。元の画像を画面に収まる大きさで出す（アニメーションも動く）。
// 同じメッセージに画像が 2 つ以上あれば左右の矢印（キーボードの左右でも）で移る。「✕」・Esc で閉じ、開く前の場所にカーソルを戻す
export default function ImageViewer({ images, start, onClose }: Props) {
  const [index, setIndex] = useState(start)
  const titleId = useId()
  const panel = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const many = images.length > 1
  const count = images.length

  useEffect(() => {
    panel.current?.focus()
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
      } else if (e.key === 'ArrowLeft' && count > 1) {
        setIndex((i) => (i + count - 1) % count)
      } else if (e.key === 'ArrowRight' && count > 1) {
        setIndex((i) => (i + 1) % count)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      opener?.focus()
    }
  }, [count, opener])

  const image = images[index]
  return (
    <div className={styles.viewerOverlay}>
      <dialog ref={panel} open className={styles.viewer} aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className={styles.viewerBar}>
          <span id={titleId} className={styles.viewerName}>{image.fileName}</span>
          {many && <span>{index + 1}/{count}</span>}
          <a href={image.downloadUrl} className={styles.viewerDownload} download={image.fileName}>ダウンロード</a>
          <button type="button" className={styles.viewerClose} aria-label="閉じる" onClick={onClose}>✕</button>
        </div>
        <div className={styles.viewerBody}>
          {many && (
            <button type="button" className={`${styles.viewerArrow} ${styles.viewerPrev}`} aria-label="前の画像"
              onClick={() => setIndex((i) => (i + count - 1) % count)}>‹</button>
          )}
          <img src={image.url} alt={image.fileName} className={styles.viewerImage} />
          {many && (
            <button type="button" className={`${styles.viewerArrow} ${styles.viewerNext}`} aria-label="次の画像"
              onClick={() => setIndex((i) => (i + 1) % count)}>›</button>
          )}
        </div>
      </dialog>
    </div>
  )
}
