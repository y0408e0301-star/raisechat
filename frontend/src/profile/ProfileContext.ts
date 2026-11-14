import { createContext, useContext } from 'react'
import type { UserSummary } from '../api'

// G-16 を開く（PF-7）。user はメッセージ・一覧に出ていた人（ワークスペースにいなければ、この表示名・アバターを出す。PF-9）、
// anchor は押した名前・アバター（この近くに出す）
export type OpenProfile = (user: Pick<UserSummary, 'username' | 'displayName' | 'avatarUrl'>, anchor: HTMLElement) => void

export const ProfileContext = createContext<OpenProfile | null>(null)

// ワークスペースの中（WorkspaceLayout）でだけ開ける。外では null なので、名前を押せるようにしない
export function useOpenProfile(): OpenProfile | null {
  return useContext(ProfileContext)
}
