import { useState } from 'react'
import ui from './ui.module.css'

type Props = {
  displayName: string
  // 署名付き URL（1 時間。FN-02 5 章の 4）。なければ頭文字を出す
  avatarUrl?: string | null
  size: 20 | 32 | 36 | 96 | 128
}

// ユーザーを表す丸（画面設計書 2.7）。アバターの画像があれば丸く切り取って出し、
// なければ（読めなければ）表示名の 1 文字目を出す
export default function Avatar({ displayName, avatarUrl, size }: Props) {
  // 読めなかった URL。URL が替われば（一覧を読み直して新しい署名付き URL になれば）また試す
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (avatarUrl && avatarUrl !== failedUrl) {
    return (
      <img className={ui.avatar} src={avatarUrl} alt={`${displayName}のアバター`} width={size} height={size}
        onError={() => setFailedUrl(avatarUrl)} />
    )
  }
  const initial = Array.from(displayName)[0] ?? '?'
  return (
    <span className={ui.avatar} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      <span aria-hidden="true">{initial}</span>
    </span>
  )
}
