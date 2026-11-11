import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ApiError, login } from '../api'
import { useAuth } from '../auth/AuthContext'
import { M } from '../messages'
import { PASSWORD_MAX, USERNAME_MAX } from '../validation'
import styles from './AuthPage.module.css'
import { afterAuthPath, type AuthPageState } from './authState'

// G-1 ログイン画面（A-5〜A-8、画面設計書 3 章）
export default function LoginPage() {
  const location = useLocation()
  const state = location.state as AuthPageState
  const navigate = useNavigate()
  const { signedIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(state?.message ?? null)
  const [sending, setSending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setSending(true)
    try {
      const me = await login(username.trim(), password)
      signedIn(me)
      navigate(afterAuthPath(state), { replace: true })
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : M[49])
      setSending(false)
    }
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>RaiseChat</h1>
      <form onSubmit={handleSubmit} noValidate>
        {message && <div className={styles.message} role="alert">{message}</div>}
        <div className={styles.field}>
          <label htmlFor="login-username">ユーザー ID</label>
          <input id="login-username" autoComplete="username" maxLength={USERNAME_MAX} autoFocus
            value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor="login-password">パスワード</label>
          <input id="login-password" type="password" autoComplete="current-password" maxLength={PASSWORD_MAX}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" className={styles.primary} disabled={!username || !password || sending}>
          {sending ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
      <p className={styles.link}><Link to="/signup" state={{ from: state?.from }}>アカウントを作る</Link></p>
    </main>
  )
}
