import { Navigate, Outlet, useLocation } from 'react-router'
import OfflineNotice from '../components/OfflineNotice'
import { afterAuthPath, type AuthPageState } from '../pages/authState'
import { useAuth } from './AuthContext'

// ログインしていないと開けない画面（G-3〜G-11）。ログインしていなければ G-1 を出し、
// ログイン（または G-2 での登録）の後に開こうとした画面へ移す（A-10）
export function RequireAuth() {
  const { me } = useAuth()
  const location = useLocation()
  if (me === undefined) return null
  if (me === null) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

// ログインしていないときだけの画面（G-1・G-2）。ログインしていれば G-3 に移す（FN-01 8 章）。
// ログイン・登録した直後は、画面の navigate より先にここが描き直されることがあるため、
// ここでも開こうとした画面（A-10）があればそこへ移す。
// ヘッダーがないので、お知らせ欄（M-50）は画面の一番上に出す
export function GuestOnly() {
  const { me } = useAuth()
  const location = useLocation()
  if (me === undefined) return null
  if (me) return <Navigate to={afterAuthPath(location.state as AuthPageState)} replace />
  return (
    <>
      <OfflineNotice />
      <Outlet />
    </>
  )
}
