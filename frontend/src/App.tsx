import { Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { GuestOnly, RequireAuth } from './auth/guards'
import Layout from './components/Layout'
import { ToastProvider } from './components/ToastProvider'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import WorkspacesPage from './pages/WorkspacesPage'

// 画面と URL（画面一覧 1 章）。BrowserRouter（テストでは MemoryRouter）の中で使う。
// G-4〜G-11 は、それぞれの機能を作るときに足す（開発計画書 3 章）
export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route element={<GuestOnly />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
          </Route>
          <Route element={<RequireAuth />}>
            {/* G-3・G-10 は簡単なヘッダーつき */}
            <Route element={<Layout />}>
              <Route path="/" element={<WorkspacesPage />} />
            </Route>
            {/* ない画面は G-3 に移す。RequireAuth の中に置き、ログインしていないときは開こうとした URL を G-1 に渡す */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ToastProvider>
    </AuthProvider>
  )
}
