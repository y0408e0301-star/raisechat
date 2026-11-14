import { useEffect, useState } from 'react'
import { ApiError, fetchMember, startDm, type ConversationDetail, type MemberView, type UserSummary } from '../api'
import { useAuth } from '../auth/AuthContext'
import Avatar from '../components/Avatar'
import Popover from '../components/Popover'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { formatUntil } from '../dates'
import { M } from '../messages'
import styles from './ProfileDialog.module.css'

// 吹き出しの幅
const WIDTH = 300

type Props = {
  workspaceId: number
  // 押した名前・アバターの人（ワークスペースにいなければ、この表示名・アバターを出す。PF-9）
  user: Pick<UserSummary, 'username' | 'displayName' | 'avatarUrl'>
  anchor: HTMLElement | null
  onClose: () => void
  // 「メッセージを送る」で開いた（なければ作った）DM
  onStartDm: (dm: ConversationDetail) => void
}

// G-16 プロフィールのダイアログ（PF-7・PF-9・DM-3、画面設計書 18 章）。
// 開くたびにいまのプロフィールを読み、ワークスペースのメンバーでなければ（404 USER_NOT_FOUND）
// メッセージに出ていた表示名・アバターと「このワークスペースにはいません」だけを出す
export default function ProfileDialog({ workspaceId, user, anchor, onClose, onStartDm }: Props) {
  const { me } = useAuth()
  const toast = useToast()
  // undefined：読み込み中、absent：ワークスペースにいない、failed：読み込みに失敗
  const [member, setMember] = useState<MemberView | 'absent' | 'failed' | undefined>(undefined)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let active = true
    fetchMember(workspaceId, user.username)
      .catch((err: unknown) => (err instanceof ApiError && err.code === 'USER_NOT_FOUND' ? 'absent' as const : 'failed' as const))
      .then((loaded) => active && setMember(loaded))
    return () => {
      active = false
    }
  }, [workspaceId, user.username])

  async function sendMessage() {
    setStarting(true)
    try {
      onStartDm(await startDm(workspaceId, user.username))
    } catch (err) {
      toast(err instanceof ApiError ? err.message : M[49])
      setStarting(false)
    }
  }

  const shown = typeof member === 'object' ? member : user
  const status = typeof member === 'object' ? [member.statusEmoji, member.statusText].filter(Boolean).join(' ') : ''
  return (
    <Popover anchor={anchor} label={`${shown.displayName}のプロフィール`} width={WIDTH} onClose={onClose}>
      <div className={styles.body}>
        <Avatar displayName={shown.displayName} avatarUrl={shown.avatarUrl} size={96} />
        <p className={styles.name}>{shown.displayName}</p>
        <p className={styles.username}>@{shown.username}</p>
        {typeof member === 'object' && status && (
          <p className={styles.status}>
            {status}
            {member.statusExpiresAt && <span className={styles.until}>（{formatUntil(member.statusExpiresAt)} まで）</span>}
          </p>
        )}
        {member === 'absent' && <p className={styles.absent}>このワークスペースにはいません</p>}
        {member === 'failed' && <p className={styles.absent} role="alert">{M[48]}</p>}
        {typeof member === 'object' && member.username !== me?.username && (
          <button type="button" className={`${ui.primary} ${styles.send}`} onClick={sendMessage} disabled={starting}>
            メッセージを送る
          </button>
        )}
      </div>
    </Popover>
  )
}
