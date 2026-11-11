import ui from './ui.module.css'

type Props = {
  displayName: string
  size: 32 | 36 | 96 | 128
}

// ユーザーを表す丸（画面設計書 2.7）。表示名の 1 文字目を出す。
// アバターの画像は、プロフィール（開発計画書 1-10）で足す
export default function Avatar({ displayName, size }: Props) {
  const initial = Array.from(displayName)[0] ?? '?'
  return (
    <span className={ui.avatar} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      <span aria-hidden="true">{initial}</span>
    </span>
  )
}
