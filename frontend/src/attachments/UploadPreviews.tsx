import styles from './Attachments.module.css'
import type { Upload } from './uploads'

type Props = {
  uploads: Upload[]
  onRetry: (localId: string) => void
  onRemove: (localId: string) => void
}

// 入力欄の上に並べる添付の見本（画面設計書 2.14、AT-1・AT-3・AT-4）。
// 画像は 64px 四方の見本、動画はファイル名。アップロード中は進み具合の帯と「80%」、失敗したら危険色の枠と「もう一度」。右上に「×」
export default function UploadPreviews({ uploads, onRetry, onRemove }: Props) {
  if (uploads.length === 0) return null
  return (
    <ul className={styles.previews} aria-label="添付">
      {uploads.map((u) => {
        const percent = Math.round(u.progress * 100)
        return (
          <li key={u.localId} className={`${styles.preview} ${u.status === 'failed' ? styles.previewFailed : ''}`}>
            {u.kind === 'IMAGE' && u.preview
              ? <img src={u.preview} alt={u.name} className={styles.previewImage} />
              : <span className={styles.previewName} title={u.name}>▶ {u.name}</span>}
            {u.status === 'uploading' && (
              <span className={styles.progress}>
                <progress max={100} value={percent} aria-label={`${u.name}のアップロード`} />
                <span>{percent}%</span>
              </span>
            )}
            {u.status === 'failed' && (
              <button type="button" className={styles.retry} onClick={() => onRetry(u.localId)}>もう一度</button>
            )}
            <button type="button" className={styles.remove} aria-label={`${u.name}を外す`} title="外す"
              onClick={() => onRemove(u.localId)}>×</button>
          </li>
        )
      })}
    </ul>
  )
}
