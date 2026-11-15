import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { M } from '../messages'
import { json, mockFetch, sentJson, type Handler } from '../test/fetchMock'
import { me } from '../test/render'
import { conversations, opened, renderAt, summary } from '../test/workspace'

// G-16 プロフィールのダイアログ（PF-7・PF-9・DM-3・MB-2・DM-5、画面設計書 18 章）

const location = () => screen.getByRole('status', { name: '今の URL' })

const hanako = {
  username: 'hanako', displayName: 'はなこ', avatarUrl: 'https://s3.example/avatars/h.png?X-Amz-Signature=a',
  statusEmoji: '🏖️', statusText: '旅行中',
}
const member = (user: object, extra: object = {}) =>
  ({ statusExpiresAt: null, ...user, role: 'MEMBER', joinedAt: '2026-11-10T01:00:00Z', ...extra })

const message = (id: number, author: object) => ({
  id, conversationId: 10, parentId: null, author, body: `${id} 通目`, attachments: [], reactions: [], replyCount: 0, lastReplyAt: null, replyUsers: [],
  createdAt: '2026-11-11T01:00:00Z', editedAt: null, deleted: false, mine: false, canDelete: true,
})

const dm = (id: number, partner: object) => ({
  ...summary(id, '', { type: 'DM', name: null, visibility: null, dmPartner: partner }),
  description: null, memberCount: 2, createdBy: me, createdAt: '2026-11-13T03:00:00Z',
})

// general に、はなこと自分のメッセージがある
function openGeneral(routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({
    ...opened,
    'GET /api/conversations/10/messages': () =>
      json(200, { items: [message(1, hanako), message(2, me)], hasMoreBefore: false, hasMoreAfter: false }),
    ...routes,
  })
  renderAt('/w/3/c/10')
  return fetch
}

const dialog = () => screen.getByRole('dialog', { name: /のプロフィール$/ })

afterEach(() => {
  vi.useRealTimers()
})

describe('G-16 を開く', () => {
  it('メッセージの名前を押すと、いまのプロフィール（アバター・表示名・@ユーザー ID・ステータスと消す時刻）を出す（PF-7）', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-14T01:00:00Z'), shouldAdvanceTime: true })
    const fetch = openGeneral({
      'GET /api/workspaces/3/members/hanako': () =>
        json(200, member(hanako, { displayName: 'はなこ（新）', statusExpiresAt: '2026-11-14T08:00:00Z' })),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'はなこ' }))

    expect(await within(dialog()).findByText('はなこ（新）')).toBeInTheDocument()
    expect(within(dialog()).getByRole('img', { name: 'はなこ（新）のアバター' })).toHaveAttribute('src', hanako.avatarUrl)
    expect(within(dialog()).getByText('@hanako')).toBeInTheDocument()
    // 今日の消す時刻は時刻だけ（日本時間の 17:00）
    expect(within(dialog()).getByText('🏖️ 旅行中', { exact: false })).toHaveTextContent('🏖️ 旅行中（17:00 まで）')
    // 開いたときは吹き出しにカーソルを置く（Tab で「メッセージを送る」に移れる）
    expect(dialog()).toHaveFocus()
    expect(fetch.keys()).toContain('GET /api/workspaces/3/members/hanako')
  })

  it('アバターを押しても開き、Esc で閉じて押したものにカーソルを戻す', async () => {
    openGeneral({ 'GET /api/workspaces/3/members/hanako': () => json(200, member(hanako)) })
    const user = userEvent.setup()
    const avatar = await screen.findByRole('button', { name: 'はなこのプロフィール' })

    await user.click(avatar)
    await within(dialog()).findByRole('button', { name: 'メッセージを送る' })
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: /のプロフィール$/ })).not.toBeInTheDocument()
    expect(avatar).toHaveFocus()
  })

  // TC-02-7
  it('自分には「メッセージを送る」を出さない', async () => {
    openGeneral({ 'GET /api/workspaces/3/members/taro_y': () => json(200, member(me, { role: 'OWNER' })) })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'たろう' }))

    expect(await within(dialog()).findByText('@taro_y')).toBeInTheDocument()
    expect(within(dialog()).queryByRole('button', { name: 'メッセージを送る' })).not.toBeInTheDocument()
  })

  // TC-02-8（PF-9）
  it('ワークスペースにいない人は、メッセージに出ていた名前と「このワークスペースにはいません」だけを出す', async () => {
    openGeneral({
      'GET /api/workspaces/3/members/hanako': () => json(404, { code: 'USER_NOT_FOUND', message: M[49] }),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'はなこ' }))

    expect(await within(dialog()).findByText('このワークスペースにはいません')).toBeInTheDocument()
    expect(within(dialog()).getByText('はなこ')).toBeInTheDocument()
    expect(within(dialog()).queryByRole('button', { name: 'メッセージを送る' })).not.toBeInTheDocument()
  })

  it('読み込めなければ M-48 を出す', async () => {
    openGeneral({ 'GET /api/workspaces/3/members/hanako': () => json(500, { code: 'INTERNAL_ERROR', message: M[49] }) })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'はなこ' }))

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(M[48])
  })

  it('メンバーの一覧の名前を押しても開く（MB-2）', async () => {
    mockFetch({
      ...opened,
      'GET /api/workspaces/3/members': () =>
        json(200, { items: [member(me, { role: 'OWNER' }), member(hanako)], nextCursor: null, memberCount: 2 }),
      'GET /api/workspaces/3/members/hanako': () => json(200, member(hanako)),
    })
    renderAt('/w/3/members')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /@hanako/ }))

    expect(await within(dialog()).findByRole('button', { name: 'メッセージを送る' })).toBeInTheDocument()
  })

  it('DM の見出しを押しても開く（DM-5）', async () => {
    mockFetch({
      ...opened,
      'GET /api/workspaces/3/conversations': () => json(200, [...conversations, dm(50, hanako)]),
      'GET /api/conversations/50': () => json(200, dm(50, hanako)),
      'GET /api/workspaces/3/members/hanako': () => json(200, member(hanako)),
    })
    renderAt('/w/3/d/50')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: /はなこ/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'はなこ' }))

    expect(await within(dialog()).findByText('@hanako')).toBeInTheDocument()
  })
})

describe('「メッセージを送る」（DM-3）', () => {
  it('その人との DM をサイドバーに足し、G-5 で開く', async () => {
    const fetch = openGeneral({
      'GET /api/workspaces/3/members/hanako': () => json(200, member(hanako)),
      'POST /api/workspaces/3/dms': () => json(200, dm(50, hanako)),
      'GET /api/conversations/50': () => json(200, dm(50, hanako)),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'はなこ' }))

    await user.click(await within(dialog()).findByRole('button', { name: 'メッセージを送る' }))

    await waitFor(() => expect(location()).toHaveTextContent('/w/3/d/50'))
    expect(screen.queryByRole('dialog', { name: /のプロフィール$/ })).not.toBeInTheDocument()
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/workspaces/3/dms'))).toEqual({ username: 'hanako' })
    expect(screen.getByRole('navigation', { name: '会話' })).toHaveTextContent('はなこ')
  })

  it('失敗したら M-49 を出し、ダイアログは開いたまま', async () => {
    openGeneral({
      'GET /api/workspaces/3/members/hanako': () => json(200, member(hanako)),
      'POST /api/workspaces/3/dms': () => json(500, { code: 'INTERNAL_ERROR', message: M[49] }),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'はなこ' }))

    await user.click(await within(dialog()).findByRole('button', { name: 'メッセージを送る' }))

    expect(await screen.findByText(M[49])).toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: 'メッセージを送る' })).toBeEnabled()
  })
})
