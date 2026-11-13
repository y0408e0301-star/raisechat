import { Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { GuestOnly, RequireAuth } from './auth/guards'
import Layout from './components/Layout'
import { ToastProvider } from './components/ToastProvider'
import { RealtimeProvider } from './realtime/RealtimeProvider'
import InvitePage from './pages/InvitePage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import WorkspacesPage from './pages/WorkspacesPage'
import ChannelsPage from './workspace/ChannelsPage'
import ConversationPage from './workspace/ConversationPage'
import InvitesPage from './workspace/InvitesPage'
import WorkspaceHome from './workspace/WorkspaceHome'
import WorkspaceLayout from './workspace/WorkspaceLayout'

// 画面と URL（画面一覧 1 章）。BrowserRouter（テストでは MemoryRouter）の中で使う。
// G-6・G-7・G-9・G-10・G-5 の DM（/w/{ws}/d/{dm}）は、それぞれの機能を作るときに足す（開発計画書 3 章）
export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        {/* ログインしている間、WebSocket でつなぐ（機能定義書 4 章） */}
        <RealtimeProvider>
          <Routes>
            <Route element={<GuestOnly />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
            </Route>
            {/* G-4 はログインしていなくても開ける（I-4） */}
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route element={<RequireAuth />}>
              {/* G-3・G-10 は簡単なヘッダーつき */}
              <Route element={<Layout />}>
                <Route path="/" element={<WorkspacesPage />} />
              </Route>
              {/* G-5 はワークスペース用のヘッダーとサイドバーつき */}
              <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
                <Route index element={<WorkspaceHome />} />
                <Route path="c/:conversationId" element={<ConversationPage />} />
                <Route path="channels" element={<ChannelsPage />} />
                <Route path="invites" element={<InvitesPage />} />
              </Route>
              {/* ない画面は G-3 に移す。RequireAuth の中に置き、ログインしていないときは開こうとした URL を G-1 に渡す */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </RealtimeProvider>
      </ToastProvider>
    </AuthProvider>
  )
}
