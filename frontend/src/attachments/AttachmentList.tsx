import { useState } from 'react'
import type { AttachmentView } from '../api'
import { M } from '../messages'
import styles from './Attachments.module.css'

type Props = {
  attachments: AttachmentView[]
  // 画像を押した（G-17 をその画像から開く。AT-5）
  onOpenImage: (index: number) => void
  // 表示できなかった（署名付き URL の期限切れなど）。メッセージを読み直して新しい URL に替える（AT-10）
  onExpired: () => void
}

// 1 MB 以上は MB、それより小さいものは KB で出す
function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`
}

// メッセージの添付（画面設計書 2.12、AT-5〜AT-8）。画像は縮小した画像を並べ、押すと G-17。
// 動画はブラウザの再生の部品（自動では再生しない）。幅・高さが分かっていれば、読み込む前からその大きさの場所を取る
export default function AttachmentList({ attachments, onOpenImage, onExpired }: Props) {
  const images = attachments.filter((a) => a.kind === 'IMAGE')
  const videos = attachments.filter((a) => a.kind === 'VIDEO')
  const single = images.length === 1
  return (
    <div className={styles.attachments}>
      {images.length > 0 && (
        <div className={styles.images}>
          {images.map((a, index) => (
            <button key={a.id} type="button" className={`${styles.imageButton} ${single ? styles.single : styles.tile}`}
              style={single ? singleSize(a) : undefined} onClick={() => onOpenImage(index)}
              aria-label={`${a.fileName}を大きく見る`}>
              <img src={a.thumbnailUrl ?? a.url} alt={a.fileName} className={styles.image} loading="lazy"
                onError={onExpired} />
            </button>
          ))}
        </div>
      )}
      {videos.map((a) => <Video key={a.id} attachment={a} onExpired={onExpired} />)}
    </div>
  )
}

// 画像 1 つは、幅 360px・高さ 360px に収まる大きさで出す。分かっていれば読み込む前から場所を取る（AT-8）
function singleSize(a: AttachmentView): { width: number, aspectRatio: string } | undefined {
  if (!a.width || !a.height) return undefined
  const scale = Math.min(1, 360 / a.width, 360 / a.height)
  return { width: Math.round(a.width * scale), aspectRatio: `${a.width} / ${a.height}` }
}

// 動画（AT-7）。ブラウザが再生できない形式（Safari の WebM など）は M-41 と「ダウンロード」を出す。
// 読み込みに失敗したら、まず URL の期限切れとみて読み直してもらい、新しい URL でも失敗したら再生できないものとする
function Video({ attachment, onExpired }: { attachment: AttachmentView, onExpired: () => void }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [unplayable, setUnplayable] = useState(() => document.createElement('video')
    .canPlayType(attachment.contentType) === '')
  const ratio = attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : '16 / 9'

  function handleError() {
    if (failedUrl === null) {
      setFailedUrl(attachment.url)
      onExpired()
    } else if (failedUrl !== attachment.url) {
      setUnplayable(true)
    }
  }

  return (
    <div className={styles.video}>
      {unplayable
        ? <p className={styles.unplayable}>{M[41]}</p>
        // 字幕のファイルはない（利用者が撮った動画を添付するため）
        // oxlint-disable-next-line jsx-a11y/media-has-caption
        : <video src={attachment.url} controls preload="metadata" className={styles.videoPlayer}
          style={{ aspectRatio: ratio }} onError={handleError} />}
      <div className={styles.videoMeta}>
        <span>{attachment.fileName} · {formatSize(attachment.size)}</span>
        <a href={attachment.downloadUrl} className={styles.download} download={attachment.fileName}>ダウンロード</a>
      </div>
    </div>
  )
}
