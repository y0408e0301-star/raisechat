import type { ReactNode } from 'react'
import type { UserSummary } from '../api'
import styles from './ProfileButton.module.css'
import { useOpenProfile } from './ProfileContext'

type Props = {
  user: Pick<UserSummary, 'username' | 'displayName' | 'avatarUrl'>
  children: ReactNode
  className?: string
  // 中身が画像だけ（アバター）のときの読み上げの名前
  label?: string
}

// 押すと G-16 を出す名前・アバター（PF-7・MB-2・DM-5）。ワークスペースの外では押せない（中身だけを出す）
export default function ProfileButton({ user, children, className, label }: Props) {
  const openProfile = useOpenProfile()
  if (!openProfile) return <>{children}</>
  return (
    <button type="button" className={`${styles.button} ${className ?? ''}`} aria-label={label}
      onClick={(e) => openProfile(user, e.currentTarget)}>
      {children}
    </button>
  )
}
