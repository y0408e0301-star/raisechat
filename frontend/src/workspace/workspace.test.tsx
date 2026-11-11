import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/AuthContext'
import { ToastProvider } from '../components/ToastProvider'
import { M } from '../messages'
import CurrentLocation from '../test/CurrentLocation'
import { json, mockFetch, sentJson } from '../test/fetchMock'
import { me } from '../test/render'
import ConversationPage from './ConversationPage'
import WorkspaceHome from './WorkspaceHome'
import WorkspaceLayout from './WorkspaceLayout'

// G-5 チャット画面の枠（FN-03 W-4・W-8・W-9、画面設計書 7 章）

const workspace = (extra: object = {}) => ({
  id: 3, name: '仲間うち', role: 'OWNER', hasUnread: false, mentionCount: 0, owner: me, memberCount: 2,
  generalConversationId: 10, lastOpenedConversationId: null, ...extra,
})

const summary = (id: number, name: string, extra: object = {}) => ({
  id, workspaceId: 3, type: 'CHANNEL', name, visibility: 'PUBLIC', general: false, dmPartner: null, joined: true,
  hasUnread: false, unreadCount: 0, mentionCount: 0, canPost: true, ...extra,
})

const detail = (id: number, name: string, extra: object = {}) => ({
  ...summary(id, name), description: null, memberCount: 2, createdBy: me, createdAt: '2026-11-11T03:00:00Z', ...extra,
})

const conversations = [summary(10, 'general', { general: true }), summary(11, '運営', { visibility: 'PRIVATE' })]

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext value={{ me, signedIn: vi.fn(), signOut: vi.fn(async () => {}) }}>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<p>G-3</p>} />
            <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
              <Route index element={<WorkspaceHome />} />
              <Route path="c/:conversationId" element={<ConversationPage />} />
            </Route>
          </Routes>
          <CurrentLocation />
        </ToastProvider>
      </AuthContext>
    </MemoryRouter>,
  )
}

const opened = {
  'GET /api/workspaces/3': () => json(200, workspace()),
  'GET /api/workspaces/3/conversations': () => json(200, conversations),
  'GET /api/conversations/10': () => json(200, detail(10, 'general', { general: true })),
  'POST /api/conversations/10/read': () => json(204),
}

const url = () => screen.getByRole('status', { name: '今の URL' })

describe('ワークスペースを開く（W-4）', () => {
  // TC-03-5
  it('初めて開くときは general を開き、開いたことを記録する', async () => {
    const fetch = mockFetch(opened)
    renderAt('/w/3')
    expect(await screen.findByRole('heading', { name: 'general' })).toBeInTheDocument()
    expect(url()).toHaveTextContent('/w/3/c/10')
    await vi.waitFor(() => expect(fetch.keys()).toContain('POST /api/conversations/10/read'))
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/conversations/10/read'))).toEqual({ lastMessageId: 0 })
  })

  // TC-03-5
  it('最後に開いた会話があればそれを開く', async () => {
    mockFetch({
      ...opened,
      'GET /api/workspaces/3': () => json(200, workspace({ lastOpenedConversationId: 11 })),
      'GET /api/conversations/11': () => json(200, detail(11, '運営', { visibility: 'PRIVATE', description: '運営の相談' })),
      'POST /api/conversations/11/read': () => json(204),
    })
    renderAt('/w/3')
    expect(await screen.findByRole('heading', { name: '運営' })).toBeInTheDocument()
    expect(screen.getByText('運営の相談')).toBeInTheDocument()
    expect(screen.getByLabelText('メンバー 2 人')).toHaveTextContent('👥 2')
    expect(url()).toHaveTextContent('/w/3/c/11')
  })

  // TC-03-6
  it('M-13：入っていない・存在しないワークスペースは G-3 に移す', async () => {
    mockFetch({
      'GET /api/workspaces/4': () => json(404, { code: 'WORKSPACE_NOT_FOUND', message: M[13] }),
      'GET /api/workspaces/4/conversations': () => json(404, { code: 'WORKSPACE_NOT_FOUND', message: M[13] }),
    })
    renderAt('/w/4/c/1')
    expect(await screen.findByText('G-3')).toBeInTheDocument()
    expect(screen.getByText(M[13])).toBeInTheDocument()
  })

  it('数字でないワークスペースの URL も G-3 に移す', async () => {
    mockFetch({})
    renderAt('/w/abc')
    expect(await screen.findByText('G-3')).toBeInTheDocument()
    expect(screen.getByText(M[13])).toBeInTheDocument()
  })

  it('M-48：読み込みに失敗したら「再読み込み」で読み込み直す', async () => {
    mockFetch({
      ...opened,
      'GET /api/workspaces/3': [() => json(500, { code: 'INTERNAL_ERROR', message: M[49] }), () => json(200, workspace())],
    })
    renderAt('/w/3/c/10')
    expect(await screen.findByText(M[48])).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '再読み込み' }))
    expect(await screen.findByRole('heading', { name: 'general' })).toBeInTheDocument()
  })
})

describe('会話（画面設計書 7.1）', () => {
  it('M-27：見られない会話は general を開く', async () => {
    mockFetch({
      ...opened,
      'GET /api/conversations/99': () => json(404, { code: 'CONVERSATION_NOT_FOUND', message: M[27] }),
    })
    renderAt('/w/3/c/99')
    expect(await screen.findByRole('heading', { name: 'general' })).toBeInTheDocument()
    expect(screen.getByText(M[27])).toBeInTheDocument()
    expect(url()).toHaveTextContent('/w/3/c/10')
  })

  it('ほかのワークスペースの会話の ID は、見られない会話として扱う', async () => {
    mockFetch({ ...opened, 'GET /api/conversations/50': () => json(200, detail(50, '別', { workspaceId: 8 })) })
    renderAt('/w/3/c/50')
    expect(await screen.findByRole('heading', { name: 'general' })).toBeInTheDocument()
    expect(screen.getByText(M[27])).toBeInTheDocument()
  })

  it('general も見られなければ G-3 に移す', async () => {
    mockFetch({
      ...opened,
      'GET /api/conversations/10': () => json(404, { code: 'CONVERSATION_NOT_FOUND', message: M[27] }),
    })
    renderAt('/w/3/c/10')
    expect(await screen.findByText('G-3')).toBeInTheDocument()
  })
})

describe('ヘッダーとサイドバー（W-9、画面設計書 2.6・2.8）', () => {
  it('ヘッダーとサイドバーにワークスペースの名前を出し、入っているチャンネルを並べる', async () => {
    mockFetch(opened)
    renderAt('/w/3/c/10')
    await screen.findByRole('heading', { name: 'general' })
    expect(within(screen.getByRole('banner')).getByRole('link', { name: '仲間うち' })).toHaveAttribute('href', '/w/3')
    const sidebar = screen.getByRole('navigation', { name: '会話' })
    expect(within(sidebar).getByRole('button', { name: '仲間うちのメニュー' })).toBeInTheDocument()
    const links = within(sidebar).getAllByRole('link')
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['#general', '/w/3/c/10'],
      ['🔒運営', '/w/3/c/11'],
    ])
    // 開いている会話
    expect(links[0]).toHaveAttribute('aria-current', 'page')
  })

  it('サイドバーのワークスペースの名前のメニューから G-3 に戻れる', async () => {
    mockFetch(opened)
    renderAt('/w/3/c/10')
    await screen.findByRole('heading', { name: 'general' })
    await userEvent.click(screen.getByRole('button', { name: '仲間うちのメニュー' }))
    await userEvent.click(within(screen.getByRole('navigation', { name: '会話' })).getByRole('link', { name: 'ワークスペースの一覧' }))
    expect(await screen.findByText('G-3')).toBeInTheDocument()
  })

  it('サイドバーで会話を選ぶと、その会話を開く', async () => {
    mockFetch({
      ...opened,
      'GET /api/conversations/11': () => json(200, detail(11, '運営', { visibility: 'PRIVATE' })),
      'POST /api/conversations/11/read': () => json(204),
    })
    renderAt('/w/3/c/10')
    await screen.findByRole('heading', { name: 'general' })
    await userEvent.click(screen.getByRole('link', { name: '運営' }))
    expect(await screen.findByRole('heading', { name: '運営' })).toBeInTheDocument()
    expect(url()).toHaveTextContent('/w/3/c/11')
  })
})
