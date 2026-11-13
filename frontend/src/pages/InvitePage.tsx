import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import {
  ApiError, acceptInvite, conversationUrl, fetchInvitePreview, workspaceUrl, type InvitePreview,
} from '../api'
import { useAuth } from '../auth/AuthContext'
import OfflineNotice from '../components/OfflineNotice'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { M } from '../messages'
import styles from './AuthPage.module.css'
import type { AuthPageState } from './authState'

// 使えない招待リンク（期限切れ・取り消し済み・存在しない。I-6）
const isInvalid = (e: unknown) => e instanceof ApiError && e.status === 410

// G-4 招待の参加画面（I-4〜I-7、画面設計書 6 章）。ログインしていなくても開ける。
// ログイン・登録の後にこの画面に戻れるよう、G-1・G-2 に今の URL を渡す（A-10）
export default function InvitePage() {
  const { token = '' } = useParams()
  const { me } = useAuth()
  if (me === undefined) return null
  // ログインした・ログアウトしたら読み直す（ログインしている人にだけ、オーナー・人数を返すため）
  return <InviteView key={me ? 'in' : 'out'} token={token} signedIn={me !== null} />
}

// undefined：読み込み中、'failed'：読み込みに失敗、'invalid'：使えない招待リンク
type Loaded = InvitePreview | 'failed' | 'invalid' | undefined

function InviteView({ token, signedIn }: { token: string, signedIn: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const [preview, setPreview] = useState<Loaded>(undefined)
  const [joining, setJoining] = useState(false)

  const load = useCallback(async () => {
    try {
      return await fetchInvitePreview(token, signedIn)
    } catch (e) {
      return isInvalid(e) ? 'invalid' as const : 'failed' as const
    }
  }, [token, signedIn])

  useEffect(() => {
    let active = true
    async function first() {
      const result = await load()
      if (active) setPreview(result)
    }
    void first()
    return () => {
      active = false
    }
  }, [load])

  const alreadyMember = typeof preview === 'object' && preview.alreadyMember === true
  // すでにメンバーなら M-19 を出して G-5 に移す（I-7）
  useEffect(() => {
    if (alreadyMember) toast(M[19])
  }, [alreadyMember, toast])

  // 参加して G-5 で general を開く（I-5）
  async function join() {
    setJoining(true)
    try {
      const joined = await acceptInvite(token)
      navigate(conversationUrl(joined.id, joined.generalConversationId), { replace: true })
    } catch (e) {
      setJoining(false)
      if (isInvalid(e)) setPreview('invalid')
      else toast(e instanceof ApiError ? e.message : M[49])
    }
  }

  async function reload() {
    setPreview(undefined)
    setPreview(await load())
  }

  if (alreadyMember && preview.workspaceId != null) return <Navigate to={workspaceUrl(preview.workspaceId)} replace />
  const from: AuthPageState = { from: location }
  return (
    <>
      <OfflineNotice />
      <main className={styles.page}>
        <h1 className={styles.title}>RaiseChat</h1>
        {preview === 'invalid' && (
          <>
            <p role="alert">{M[18]}</p>
            {signedIn && <Link to="/" className={`${ui.secondary} ${styles.wide}`}>ワークスペースの一覧へ</Link>}
          </>
        )}
        {preview === 'failed' && (
          <div className={ui.empty}>
            <p>{M[48]}</p>
            <button type="button" className={ui.secondary} onClick={reload}>再読み込み</button>
          </div>
        )}
        {typeof preview === 'object' && (
          <>
            <p className={styles.subtitle}>「{preview.workspaceName}」に招待されています</p>
            {signedIn ? (
              <>
                <p className={styles.center}>
                  オーナー：{preview.ownerDisplayName} · メンバー {preview.memberCount} 人
                </p>
                <button type="button" className={styles.primary} onClick={join} disabled={joining}>
                  {joining ? '参加中…' : '参加する'}
                </button>
              </>
            ) : (
              // ログイン・登録の後にこの画面に戻る（I-4）
              <>
                <button type="button" className={styles.primary} onClick={() => navigate('/login', { state: from })}>
                  ログイン
                </button>
                <button type="button" className={`${ui.secondary} ${styles.wide}`}
                  onClick={() => navigate('/signup', { state: from })}>アカウントを作る</button>
              </>
            )}
          </>
        )}
      </main>
    </>
  )
}
