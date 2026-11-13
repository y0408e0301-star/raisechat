import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import { AuthContext } from '../auth/AuthContext'
import { ToastProvider } from '../components/ToastProvider'
import { M } from '../messages'
import { RealtimeProvider } from '../realtime/RealtimeProvider'
import ChannelsPage from '../workspace/ChannelsPage'
import ConversationPage from '../workspace/ConversationPage'
import InvitesPage from '../workspace/InvitesPage'
import MembersPage from '../workspace/MembersPage'
import WorkspaceHome from '../workspace/WorkspaceHome'
import WorkspaceLayout from '../workspace/WorkspaceLayout'
import CurrentLocation from './CurrentLocation'
import { json } from './fetchMock'
import { me } from './render'

// G-5 チャット画面のテストで使う準備。ワークスペース 3（仲間うち）に、general（10）と運営（11）がある

export const workspace = (extra: object = {}) => ({
  id: 3, name: '仲間うち', role: 'OWNER', hasUnread: false, mentionCount: 0, owner: me, memberCount: 2,
  generalConversationId: 10, lastOpenedConversationId: null, ...extra,
})

export const summary = (id: number, name: string, extra: object = {}) => ({
  id, workspaceId: 3, type: 'CHANNEL', name, visibility: 'PUBLIC', general: false, dmPartner: null, joined: true,
  hasUnread: false, unreadCount: 0, mentionCount: 0, canPost: true, ...extra,
})

export const detail = (id: number, name: string, extra: object = {}) => ({
  ...summary(id, name), description: null, memberCount: 2, createdBy: me, createdAt: '2026-11-11T03:00:00Z', ...extra,
})

export const conversations = [summary(10, 'general', { general: true }), summary(11, '運営', { visibility: 'PRIVATE' })]

// path の画面を開く。G-3 は「G-3」の文字だけ。ログインしているので WebSocket の偽物を作ってつなぎ始める
export function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext value={{ me, signedIn: vi.fn(), signOut: vi.fn(async () => {}) }}>
        <ToastProvider>
          {/* WebSocket は偽物（src/test/fakeStomp.ts）。Client.latest() でつないだり通知を届けたりする */}
          <RealtimeProvider>
            <Routes>
              <Route path="/" element={<p>G-3</p>} />
              <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
                <Route index element={<WorkspaceHome />} />
                <Route path="c/:conversationId" element={<ConversationPage />} />
                <Route path="channels" element={<ChannelsPage />} />
                <Route path="members" element={<MembersPage />} />
                <Route path="invites" element={<InvitesPage />} />
              </Route>
            </Routes>
            <CurrentLocation />
          </RealtimeProvider>
        </ToastProvider>
      </AuthContext>
    </MemoryRouter>,
  )
}

export const noMessages = () => json(200, { items: [], hasMoreBefore: false, hasMoreAfter: false })

// ワークスペースと general を開いたときの API
export const opened = {
  'GET /api/workspaces/3': () => json(200, workspace()),
  'GET /api/conversations/10/messages': noMessages,
  'GET /api/conversations/11/messages': noMessages,
  'GET /api/conversations/50/messages': noMessages,
  'GET /api/conversations/99/messages': () => json(404, { code: 'CONVERSATION_NOT_FOUND', message: M[27] }),
  'GET /api/workspaces/3/conversations': () => json(200, conversations),
  'GET /api/conversations/10': () => json(200, detail(10, 'general', { general: true })),
  'POST /api/conversations/10/read': () => json(204),
}

