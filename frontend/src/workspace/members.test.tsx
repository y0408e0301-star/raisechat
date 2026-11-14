import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/AuthContext'
import { ToastProvider } from '../components/ToastProvider'
import { M, M14, M15, M21, M22, M23 } from '../messages'
import WorkspacesPage from '../pages/WorkspacesPage'
import { USER_EVENTS } from '../realtime/connection'
import { RealtimeProvider } from '../realtime/RealtimeProvider'
import { Client } from '../test/fakeStomp'
import { json, mockFetch, sentJson, type Handler } from '../test/fetchMock'
import { me } from '../test/render'
import { opened, renderAt, workspace } from '../test/workspace'

// メンバー管理（FN-05）とワークスペースの削除（FN-03 W-6・W-7）の画面：サイドバーのメニュー・G-9・G-18・workspace.removed

const sidebar = () => screen.getByRole('navigation', { name: '会話' })
const location = () => screen.getByRole('status', { name: '今の URL' })
// G-9 の行（サイドバーの行は数えない）
const rows = () => within(screen.getByRole('main')).getAllByRole('listitem')

function open(path: string, routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({ ...opened, ...routes })
  renderAt(path)
  return fetch
}

const member = (username: string, displayName: string, extra: object = {}) => ({
  username, displayName, avatarUrl: null, statusEmoji: null, statusText: null, role: 'MEMBER',
  joinedAt: '2026-11-10T01:00:00Z', ...extra,
})
const taro = member('taro_y', 'たろう', { role: 'OWNER' })
const hanako = member('hanako', 'はなこ', { statusEmoji: '🏖' })
const jiro = member('jiro', 'じろう')

const page = (items: object[], memberCount = items.length, nextCursor: string | null = null) =>
  () => json(200, { items, nextCursor, memberCount })

const MEMBERS = 'GET /api/workspaces/3/members'

const removed = (reason: string) =>
  ({ type: 'workspace.removed', workspaceId: 3, conversationId: null, payload: { workspaceId: 3, name: '仲間うち', reason }, sentAt: '2026-11-13T01:00:00Z' })

describe('サイドバーのメニュー（MB-1）', () => {
  it('「メンバー」で G-9 を開き、人数とオーナーの印を出す', async () => {
    open('/w/3/c/10', { [MEMBERS]: page([taro, hanako, jiro]) })
    const user = userEvent.setup()
    await screen.findByRole('navigation', { name: '会話' })

    await user.click(within(sidebar()).getByRole('button', { name: '仲間うちのメニュー' }))
    await user.click(within(sidebar()).getByRole('link', { name: 'メンバー' }))

    expect(location()).toHaveTextContent('/w/3/members')
    expect(await screen.findByRole('heading', { level: 1, name: 'メンバー（3 人）' })).toBeInTheDocument()
    expect(rows()[0]).toHaveTextContent('たろう@taro_yオーナー')
    expect(rows()[1]).toHaveTextContent('はなこ 🏖@hanako')
    expect(rows()[1]).not.toHaveTextContent('オーナー')
  })
})

describe('G-9 メンバー一覧画面（MB-1、TC-05-1）', () => {
  it('入力が止まったら絞り込んで読み直し、いなければ M-47 を出す。30 文字より後は入らない', async () => {
    const fetch = open('/w/3/members', {
      [MEMBERS]: page([taro, hanako, jiro]),
      [`${MEMBERS}?q=zz`]: page([], 3),
    })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'メンバー（3 人）' })

    await user.type(screen.getByRole('searchbox', { name: '名前で絞り込む' }), 'zz')

    expect(await screen.findByText(M[47])).toBeInTheDocument()
    expect(fetch.keys()).toContain(`${MEMBERS}?q=zz`)
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'a'.repeat(31))
    expect(screen.getByRole('searchbox')).toHaveValue('a'.repeat(30))
  })

  it('読み込みに失敗したら M-48 と「再読み込み」を出す', async () => {
    open('/w/3/members', { [MEMBERS]: [() => json(500, { code: 'INTERNAL_ERROR', message: M[49] }), page([taro])] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: '再読み込み' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'メンバー（1 人）' })).toBeInTheDocument()
  })
})

describe('キック（MB-3、TC-05-2）', () => {
  it('オーナーには自分以外の行に「キック」を出し、G-18 に M-21 を出してキックすると一覧から消す', async () => {
    const fetch = open('/w/3/members', {
      [MEMBERS]: page([taro, hanako, jiro]),
      'DELETE /api/workspaces/3/members/hanako': () => json(204),
    })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'メンバー（3 人）' })
    expect(within(rows()[0]).queryByRole('button', { name: /キック/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'はなこをキック' }))
    const dialog = screen.getByRole('dialog', { name: 'メンバーのキック' })
    expect(dialog).toHaveTextContent(M21('はなこ'))
    await user.click(within(dialog).getByRole('button', { name: 'キック' }))

    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    expect(screen.getByRole('heading', { level: 1, name: 'メンバー（2 人）' })).toBeInTheDocument()
    expect(fetch.keys()).toContain('DELETE /api/workspaces/3/members/hanako')
  })

  it('オーナーでない人には「キック」と「ワークスペースを削除」を出さず、「ワークスペースから退出」を出す', async () => {
    open('/w/3/members', {
      'GET /api/workspaces/3': () => json(200, workspace({ role: 'MEMBER' })),
      [MEMBERS]: page([taro, hanako, jiro]),
    })

    await screen.findByRole('heading', { level: 1, name: 'メンバー（3 人）' })

    expect(screen.queryByRole('button', { name: /キック/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ワークスペースを削除' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ワークスペースから退出' })).toBeInTheDocument()
  })

  it('キックしようとした人がもういなければ M-49 を出して一覧を読み直す', async () => {
    open('/w/3/members', {
      [MEMBERS]: [page([taro, hanako]), page([taro])],
      'DELETE /api/workspaces/3/members/hanako': () => json(404, { code: 'USER_NOT_FOUND', message: M[49] }),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'はなこをキック' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'キック' }))

    expect(await screen.findByText(M[49])).toBeInTheDocument()
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
  })
})

describe('退出（MB-5、TC-05-6）', () => {
  it('G-18 に M-23 を出し、退出すると G-3 に移る', async () => {
    const fetch = open('/w/3/members', {
      'GET /api/workspaces/3': () => json(200, workspace({ role: 'MEMBER' })),
      [MEMBERS]: page([taro, hanako]),
      'POST /api/workspaces/3/leave': () => json(204),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'ワークスペースから退出' }))
    const dialog = screen.getByRole('dialog', { name: 'ワークスペースから退出' })
    expect(dialog).toHaveTextContent(M23('仲間うち'))
    await user.click(within(dialog).getByRole('button', { name: '退出' }))

    await vi.waitFor(() => expect(location()).toHaveTextContent(/^\/$/))
    expect(fetch.keys()).toContain('POST /api/workspaces/3/leave')
  })
})

describe('ワークスペースの削除（W-6）', () => {
  it('名前が同じになるまで「削除」を押せず、削除すると G-3 に移る', async () => {
    const fetch = open('/w/3/members', {
      [MEMBERS]: page([taro]),
      'DELETE /api/workspaces/3': () => json(204),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'ワークスペースを削除' }))
    const dialog = screen.getByRole('dialog', { name: 'ワークスペースの削除' })
    expect(dialog).toHaveTextContent(M14('仲間うち'))
    const input = within(dialog).getByRole('textbox', { name: 'ワークスペースの名前' })
    expect(input).toHaveFocus()
    await user.type(input, '仲間')
    expect(within(dialog).getByRole('button', { name: '削除' })).toBeDisabled()
    await user.type(input, 'うち')
    await user.click(within(dialog).getByRole('button', { name: '削除' }))

    await vi.waitFor(() => expect(location()).toHaveTextContent(/^\/$/))
    expect(sentJson(fetch, fetch.keys().indexOf('DELETE /api/workspaces/3'))).toEqual({ confirmName: '仲間うち' })
  })

  it('失敗したら M-49 を出して閉じる', async () => {
    open('/w/3/members', {
      [MEMBERS]: page([taro]),
      'DELETE /api/workspaces/3': () => json(500, { code: 'INTERNAL_ERROR', message: M[49] }),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'ワークスペースを削除' }))
    await user.type(screen.getByRole('textbox', { name: 'ワークスペースの名前' }), '仲間うち')
    await user.click(screen.getByRole('button', { name: '削除' }))

    expect(await screen.findByText(M[49])).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(location()).toHaveTextContent('/w/3/members')
  })
})

// role の人として G-5 を開き、WebSocket をつなぐ
async function connected(role: string) {
  open('/w/3/c/10', { 'GET /api/workspaces/3': () => json(200, workspace({ role })) })
  await screen.findByRole('textbox', { name: 'メッセージ' })
  const client = Client.latest()
  await act(() => client.connect())
  return client
}

describe('ワークスペースから外れたときの通知（MB-4・W-7、TC-05-3）', () => {
  it('キックされたら M-22 を出して G-3 に移る', async () => {
    const client = await connected('MEMBER')

    act(() => client.deliver(USER_EVENTS, removed('KICKED')))

    expect(await screen.findByText(M22('仲間うち'))).toBeInTheDocument()
    expect(location()).toHaveTextContent(/^\/$/)
  })

  it('削除されたらメンバーには M-15 を出して G-3 に移る', async () => {
    const client = await connected('MEMBER')

    act(() => client.deliver(USER_EVENTS, removed('DELETED')))

    expect(await screen.findByText(M15('仲間うち'))).toBeInTheDocument()
    expect(location()).toHaveTextContent(/^\/$/)
  })

  it('オーナーが削除したときは、ほかのタブでも M-15 を出さずに G-3 に移る', async () => {
    const client = await connected('OWNER')

    act(() => client.deliver(USER_EVENTS, removed('DELETED')))

    await vi.waitFor(() => expect(location()).toHaveTextContent(/^\/$/))
    expect(screen.queryByText(M15('仲間うち'))).not.toBeInTheDocument()
  })

  it('ほかのワークスペースの通知では移らない', async () => {
    const client = await connected('MEMBER')

    act(() => client.deliver(USER_EVENTS, { ...removed('KICKED'), workspaceId: 4 }))

    expect(location()).toHaveTextContent('/w/3/c/10')
  })

  it('G-3 を開いていたら、そのワークスペースを一覧から消す', async () => {
    mockFetch({
      'GET /api/workspaces': () => json(200, [
        { id: 3, name: '仲間うち', role: 'MEMBER', hasUnread: false, mentionCount: 0 },
        { id: 4, name: '家族', role: 'OWNER', hasUnread: false, mentionCount: 0 },
      ]),
    })
    render(
      <MemoryRouter>
        <AuthContext value={{ me, signedIn: vi.fn(), signOut: vi.fn(async () => {}) }}>
          <ToastProvider>
            <RealtimeProvider><WorkspacesPage /></RealtimeProvider>
          </ToastProvider>
        </AuthContext>
      </MemoryRouter>,
    )
    await screen.findByRole('link', { name: /仲間うち/ })
    const client = Client.latest()
    await act(() => client.connect())

    act(() => client.deliver(USER_EVENTS, removed('KICKED')))

    await vi.waitFor(() => expect(screen.queryByRole('link', { name: /仲間うち/ })).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: /家族/ })).toBeInTheDocument()
  })
})
