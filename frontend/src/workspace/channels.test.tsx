import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { M, M26, M28, M29 } from '../messages'
import { USER_EVENTS } from '../realtime/connection'
import { Client } from '../test/fakeStomp'
import { json, mockFetch, sentJson, type Handler } from '../test/fetchMock'
import { me } from '../test/render'
import { conversations, detail, opened, renderAt, summary, workspace } from '../test/workspace'

// チャンネル（FN-06）の画面：サイドバー・G-8・G-13・G-14・G-18・参加していない公開チャンネル

const hanako = { username: 'hanako', displayName: 'はなこ', avatarUrl: null, statusEmoji: null, statusText: null }
const jiro = { username: 'jiro', displayName: 'じろう', avatarUrl: null, statusEmoji: null, statusText: null }

const sidebar = () => screen.getByRole('navigation', { name: '会話' })
const location = () => screen.getByRole('status', { name: '今の URL' })
const noMessages = () => json(200, { items: [], hasMoreBefore: false, hasMoreAfter: false })

function open(path: string, routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({ ...opened, ...routes })
  renderAt(path)
  return fetch
}

const list = (items: object[], nextCursor: string | null = null) => () => json(200, { items, nextCursor })
const item = (id: number, name: string, extra: object = {}) =>
  ({ id, name, description: null, visibility: 'PUBLIC', memberCount: 3, joined: false, ...extra })

const members = (items: object[]) => () => json(200, { items, nextCursor: null })

async function openDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'チャンネルの詳細' }))
  return screen.getByRole('dialog')
}

async function connected(path: string, routes: Record<string, Handler | Handler[]> = {}) {
  open(path, routes)
  await screen.findByRole('textbox', { name: 'メッセージ' })
  const client = Client.latest()
  await act(() => client.connect())
  return client
}

const event = (type: string, conversationId: number, payload: object) =>
  ({ type, workspaceId: 3, conversationId, payload, sentAt: '2026-11-11T01:00:00Z' })

describe('チャンネルを作る（CH-2、G-13）', () => {
  it('サイドバーの「＋」で開き、空白は「-」にして作り、サイドバーに足して開く', async () => {
    const fetch = open('/w/3/c/10', {
      'POST /api/workspaces/3/channels': () => json(201, detail(12, '旅行-計画')),
      'GET /api/conversations/12': () => json(200, detail(12, '旅行-計画')),
      'GET /api/conversations/12/messages': noMessages,
      'POST /api/conversations/12/read': () => json(204),
    })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: /general/ })
    await user.click(within(sidebar()).getByRole('button', { name: 'チャンネルを作る' }))
    const dialog = screen.getByRole('dialog', { name: 'チャンネルを作る' })
    await user.type(within(dialog).getByRole('textbox', { name: '名前' }), '旅行 計画')
    expect(within(dialog).getByRole('textbox', { name: '名前' })).toHaveValue('旅行-計画')
    await user.type(within(dialog).getByRole('textbox', { name: '説明（任意）' }), ' 夏の相談 ')
    await user.click(within(dialog).getByRole('radio', { name: /プライベート/ }))
    await user.click(within(dialog).getByRole('button', { name: '作る' }))

    await vi.waitFor(() => expect(location()).toHaveTextContent('/w/3/c/12'))
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/workspaces/3/channels')))
      .toEqual({ name: '旅行-計画', description: '夏の相談', visibility: 'PRIVATE' })
    expect(within(sidebar()).getByRole('link', { name: /旅行-計画/ })).toBeInTheDocument()
  })

  it('名前がなければ M-24、同じ名前があれば M-25 を入力欄の下に出す', async () => {
    open('/w/3/c/10', {
      'POST /api/workspaces/3/channels': () => json(409, { code: 'CHANNEL_NAME_TAKEN', message: M[25], field: 'name' }),
    })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: /general/ })
    await user.click(within(sidebar()).getByRole('button', { name: 'チャンネルを作る' }))
    const dialog = screen.getByRole('dialog', { name: 'チャンネルを作る' })
    await user.type(within(dialog).getByRole('textbox', { name: '名前' }), '   ')
    await user.click(within(dialog).getByRole('button', { name: '作る' }))
    expect(within(dialog).getByText(M[24])).toBeInTheDocument()

    await user.clear(within(dialog).getByRole('textbox', { name: '名前' }))
    await user.type(within(dialog).getByRole('textbox', { name: '名前' }), 'General')
    await user.click(within(dialog).getByRole('button', { name: '作る' }))
    expect(await within(dialog).findByText(M[25])).toBeInTheDocument()
  })
})

describe('チャンネルを探す（CH-3・CH-4、G-8）', () => {

  it('参加中の印と「参加する」を出し、参加すると G-5 で開いてサイドバーに足す', async () => {
    const fetch = open('/w/3/channels', {
      'GET /api/workspaces/3/channels': list([
        item(12, '雑談', { description: '何でも' }), item(10, 'general', { joined: true }),
      ]),
      'POST /api/conversations/12/join': () => json(200, detail(12, '雑談')),
      'GET /api/conversations/12': () => json(200, detail(12, '雑談')),
      'GET /api/conversations/12/messages': noMessages,
      'POST /api/conversations/12/read': () => json(204),
    })
    const user = userEvent.setup()
    await screen.findByRole('button', { name: '雑談に参加する' })
    const rows = within(screen.getByRole('main')).getAllByRole('listitem')
    const general = rows.find((r) => r.textContent?.includes('general'))!
    expect(within(general).getByText('参加中')).toBeInTheDocument()
    expect(screen.getByText('何でも')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /雑談/ })).toHaveAttribute('href', '/w/3/c/12')

    await user.click(screen.getByRole('button', { name: '雑談に参加する' }))

    await vi.waitFor(() => expect(location()).toHaveTextContent('/w/3/c/12'))
    expect(fetch.keys()).toContain('POST /api/conversations/12/join')
    expect(within(sidebar()).getByRole('link', { name: /雑談/ })).toBeInTheDocument()
  })

  it('名前で絞り込み、なければ「一致するチャンネルはありません。」', async () => {
    const fetch = open('/w/3/channels', {
      'GET /api/workspaces/3/channels': list([item(12, '雑談')]),
      'GET /api/workspaces/3/channels?q=%E6%97%85': list([]),
    })
    const user = userEvent.setup()
    await screen.findByRole('link', { name: /雑談/ })
    await user.type(screen.getByRole('searchbox', { name: '名前で絞り込む' }), '旅')
    expect(await screen.findByText('一致するチャンネルはありません。')).toBeInTheDocument()
    expect(fetch.keys()).toContain('GET /api/workspaces/3/channels?q=%E6%97%85')
  })

  it('「チャンネルを作る」で G-13 を開く', async () => {
    open('/w/3/channels', { 'GET /api/workspaces/3/channels': list([]) })
    const user = userEvent.setup()
    await screen.findByText('チャンネルはありません。')
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'チャンネルを作る' }))
    expect(screen.getByRole('dialog', { name: 'チャンネルを作る' })).toBeInTheDocument()
  })
})

describe('参加していない公開チャンネル（CH-5）', () => {
  it('入力欄の代わりに M-30 と「参加する」を出し、参加すると入力欄を出してサイドバーに足す', async () => {
    open('/w/3/c/12', {
      'GET /api/conversations/12': () => json(200, detail(12, '雑談', { joined: false, canPost: false })),
      'GET /api/conversations/12/messages': noMessages,
      'POST /api/conversations/12/read': () => json(204),
      'POST /api/conversations/12/join': () => json(200, detail(12, '雑談', { memberCount: 3 })),
    })
    const user = userEvent.setup()
    expect(await screen.findByText(M[30])).toBeInTheDocument()
    expect(within(sidebar()).queryByRole('link', { name: /雑談/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '参加する' }))

    expect(await screen.findByRole('textbox', { name: 'メッセージ' })).toBeInTheDocument()
    expect(screen.queryByText(M[30])).not.toBeInTheDocument()
    expect(within(sidebar()).getByRole('link', { name: /雑談/ })).toBeInTheDocument()
  })
})

const withChannel12 = (extra: object = {}, routes: Record<string, Handler | Handler[]> = {}) => ({
  'GET /api/workspaces/3/conversations': () => json(200, [...conversations, summary(12, '雑談')]),
  'GET /api/conversations/12': () => json(200, detail(12, '雑談', { description: '何でも', ...extra })),
  'GET /api/conversations/12/messages': noMessages,
  'POST /api/conversations/12/read': () => json(204),
  'GET /api/conversations/12/members': members([hanako, me]),
  ...routes,
})

describe('チャンネルの詳細（CH-6〜CH-9、G-14・G-18）', () => {
  it('名前・説明・種類・作った人とメンバーの一覧を出す', async () => {
    open('/w/3/c/12', withChannel12())
    const user = userEvent.setup()
    const dialog = await openDetails(user)
    expect(within(dialog).getByRole('heading', { name: '# 雑談' })).toBeInTheDocument()
    expect(within(dialog).getByText('何でも')).toBeInTheDocument()
    expect(within(dialog).getByText('公開チャンネル')).toBeInTheDocument()
    expect(await within(dialog).findByText('@hanako')).toBeInTheDocument()
    expect(within(dialog).getByText('メンバー（2）')).toBeInTheDocument()
    // 公開チャンネルには「メンバーを招待」を出さない
    expect(within(dialog).queryByRole('button', { name: 'メンバーを招待' })).not.toBeInTheDocument()
  })

  // TC-06-9
  it('名前・説明に入れたタグは文字のまま出す', async () => {
    open('/w/3/c/12', withChannel12({ name: '<script>alert(1)</script>', description: '<b>説明</b>' }))
    const user = userEvent.setup()
    const dialog = await openDetails(user)
    expect(within(dialog).getByRole('heading', { name: '# <script>alert(1)</script>' })).toBeInTheDocument()
    expect(within(dialog).getByText('<b>説明</b>')).toBeInTheDocument()
    expect(dialog.querySelector('script, b')).toBeNull()
  })

  it('公開チャンネルは確認なしで退出し、サイドバーから消して general に移る', async () => {
    const fetch = open('/w/3/c/12', withChannel12({}, { 'POST /api/conversations/12/leave': () => json(204) }))
    const user = userEvent.setup()
    const dialog = await openDetails(user)
    await user.click(within(dialog).getByRole('button', { name: 'チャンネルから退出' }))

    await vi.waitFor(() => expect(location()).toHaveTextContent('/w/3/c/10'))
    expect(fetch.keys()).toContain('POST /api/conversations/12/leave')
    expect(within(sidebar()).queryByRole('link', { name: /雑談/ })).not.toBeInTheDocument()
  })

  // N-28
  it('プライベートチャンネルは M-29 で確かめてから退出する', async () => {
    const fetch = open('/w/3/c/12', withChannel12({ visibility: 'PRIVATE' }, {
      'POST /api/conversations/12/leave': () => json(204),
    }))
    const user = userEvent.setup()
    const dialog = await openDetails(user)
    await user.click(within(dialog).getByRole('button', { name: 'チャンネルから退出' }))
    const confirm = screen.getByRole('dialog', { name: 'チャンネルから退出' })
    expect(confirm).toHaveTextContent(M29('雑談'))
    expect(within(confirm).getByRole('button', { name: 'キャンセル' })).toHaveFocus()
    expect(fetch.keys()).not.toContain('POST /api/conversations/12/leave')

    await user.click(within(confirm).getByRole('button', { name: '退出' }))
    await vi.waitFor(() => expect(location()).toHaveTextContent('/w/3/c/10'))
  })

  // N-28、CH-13
  it('オーナーは M-26 で確かめて削除する。general には退出・削除を出さない', async () => {
    const fetch = open('/w/3/c/12', withChannel12({}, { 'DELETE /api/conversations/12': () => json(204) }))
    const user = userEvent.setup()
    const dialog = await openDetails(user)
    await user.click(within(dialog).getByRole('button', { name: 'チャンネルを削除' }))
    const confirm = screen.getByRole('dialog', { name: 'チャンネルの削除' })
    expect(confirm).toHaveTextContent(M26('雑談'))
    await user.click(within(confirm).getByRole('button', { name: '削除' }))

    await vi.waitFor(() => expect(location()).toHaveTextContent('/w/3/c/10'))
    expect(fetch.keys()).toContain('DELETE /api/conversations/12')
    expect(within(sidebar()).queryByRole('link', { name: /雑談/ })).not.toBeInTheDocument()
  })

  it('general と、オーナーでない人には削除を出さない', async () => {
    open('/w/3/c/10', {
      'GET /api/workspaces/3': () => json(200, workspace({ role: 'MEMBER' })),
      'GET /api/conversations/10/members': members([me]),
    })
    const user = userEvent.setup()
    const dialog = await openDetails(user)
    expect(within(dialog).queryByRole('button', { name: 'チャンネルから退出' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'チャンネルを削除' })).not.toBeInTheDocument()
  })

  it('プライベートチャンネルのメンバーは、名前で探して選んだ人を招待できる', async () => {
    const fetch = open('/w/3/c/12', withChannel12({ visibility: 'PRIVATE' }, {
      'GET /api/conversations/12/candidates': () => json(200, [hanako, jiro]),
      'GET /api/conversations/12/candidates?q=%E3%81%98': () => json(200, [jiro]),
      'POST /api/conversations/12/members': () => json(200, [jiro]),
    }))
    const user = userEvent.setup()
    const dialog = await openDetails(user)
    await user.click(within(dialog).getByRole('button', { name: 'メンバーを招待' }))
    const invite = screen.getByRole('dialog', { name: /招待する人を選ぶ/ })
    expect(within(invite).getByRole('button', { name: '招待する（0）' })).toBeDisabled()
    await user.type(within(invite).getByRole('searchbox', { name: '招待する人を名前で探す' }), 'じ')
    await user.click(await within(invite).findByRole('checkbox', { name: 'じろう（@jiro）' }))
    await user.click(within(invite).getByRole('button', { name: '招待する（1）' }))

    expect(await screen.findByText('メンバー（3）')).toBeInTheDocument()
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/conversations/12/members'))).toEqual({ usernames: ['jiro'] })
  })

  it('1 回に招待できるのは 50 人までで、50 人選んだらほかの人は選べない', async () => {
    const many = Array.from({ length: 51 }, (_, i) =>
      ({ ...hanako, username: `user${i}`, displayName: `ユーザー${String(i).padStart(2, '0')}` }))
    open('/w/3/c/12', withChannel12({ visibility: 'PRIVATE' }, {
      'GET /api/conversations/12/candidates': () => json(200, many),
    }))
    const user = userEvent.setup()
    const dialog = await openDetails(user)
    await user.click(within(dialog).getByRole('button', { name: 'メンバーを招待' }))
    const boxes = await screen.findAllByRole('checkbox')
    for (const box of boxes.slice(0, 50)) await user.click(box)

    expect(screen.getByRole('button', { name: '招待する（50）' })).toBeEnabled()
    expect(boxes[50]).toBeDisabled()
    expect(screen.getByText('1 回に招待できるのは 50 人までです。')).toBeInTheDocument()
  })

  it('招待の候補がいなければ M-47', async () => {
    open('/w/3/c/12', withChannel12({ visibility: 'PRIVATE' }, {
      'GET /api/conversations/12/candidates': () => json(200, []),
    }))
    const user = userEvent.setup()
    const dialog = await openDetails(user)
    await user.click(within(dialog).getByRole('button', { name: 'メンバーを招待' }))
    expect(await screen.findByText(M[47])).toBeInTheDocument()
  })
})

describe('本人あての通知（CH-7・CH-10、画面設計書 7.3）', () => {

  it('招待されたチャンネルをサイドバーにすぐ足し、ほかのワークスペースの通知は無視する', async () => {
    const client = await connected('/w/3/c/10')
    act(() => client.deliver(USER_EVENTS, event('conversation.updated', 12, summary(12, '運営2', { visibility: 'PRIVATE' }))))
    expect(within(sidebar()).getByRole('link', { name: /運営2/ })).toBeInTheDocument()
    act(() => client.deliver(USER_EVENTS, { ...event('conversation.updated', 13, summary(13, 'よそ')), workspaceId: 4 }))
    expect(within(sidebar()).queryByRole('link', { name: /よそ/ })).not.toBeInTheDocument()
  })

  it('開いているチャンネルが削除されたら M-28 を出して general に移り、サイドバーから消す', async () => {
    const client = await connected('/w/3/c/11', {
      'GET /api/conversations/11': () => json(200, detail(11, '運営', { visibility: 'PRIVATE' })),
      'POST /api/conversations/11/read': () => json(204),
    })
    act(() => client.deliver(USER_EVENTS, event('conversation.removed', 11, { conversationId: 11, reason: 'DELETED' })))

    expect(await screen.findByText(M28('運営'))).toBeInTheDocument()
    await vi.waitFor(() => expect(location()).toHaveTextContent('/w/3/c/10'))
    expect(within(sidebar()).queryByRole('link', { name: /運営/ })).not.toBeInTheDocument()
  })

  it('開いていないチャンネルから抜けたら、サイドバーから消すだけ', async () => {
    const client = await connected('/w/3/c/10')
    act(() => client.deliver(USER_EVENTS, event('conversation.removed', 11, { conversationId: 11, reason: 'LEFT' })))
    expect(within(sidebar()).queryByRole('link', { name: /運営/ })).not.toBeInTheDocument()
    expect(location()).toHaveTextContent('/w/3/c/10')
  })
})
