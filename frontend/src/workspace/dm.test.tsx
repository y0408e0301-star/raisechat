import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { M, M36 } from '../messages'
import { USER_EVENTS } from '../realtime/connection'
import { Client } from '../test/fakeStomp'
import { json, mockFetch, sentJson, type Handler } from '../test/fetchMock'
import { me } from '../test/render'
import { conversations, opened, renderAt, summary } from '../test/workspace'
import type { ConversationSummary } from '../api'
import { upsertConversation } from './sidebarList'

// DM（FN-12）の画面：サイドバーの「ダイレクトメッセージ」・G-15・DM の会話・相手が抜けたとき

const sidebar = () => screen.getByRole('navigation', { name: '会話' })
const location = () => screen.getByRole('status', { name: '今の URL' })

const hanako = { username: 'hanako', displayName: 'はなこ', avatarUrl: null, statusEmoji: '🏖', statusText: '旅行中' }
const jiro = { username: 'jiro', displayName: 'じろう', avatarUrl: null, statusEmoji: null, statusText: null }

const dmSummary = (id: number, partner: object, extra: object = {}) => summary(id, '', {
  type: 'DM', name: null, visibility: null, dmPartner: partner, ...extra,
})
const dmDetail = (id: number, partner: object, extra: object = {}) => ({
  ...dmSummary(id, partner, extra), description: null, memberCount: 2, createdBy: me, createdAt: '2026-11-13T03:00:00Z',
})
const member = (user: object, extra: object = {}) =>
  ({ ...user, role: 'MEMBER', joinedAt: '2026-11-10T01:00:00Z', ...extra })

// from 番目から count 人のメンバー
const people = (from: number, count: number) => Array.from({ length: count }, (_, i) =>
  member({ ...jiro, username: `user${from + i}`, displayName: `ユーザー${from + i}` }))

const withDms = [...conversations, dmSummary(50, hanako), dmSummary(51, jiro)]

function open(path: string, routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({
    ...opened,
    'GET /api/workspaces/3/conversations': () => json(200, withDms),
    'GET /api/conversations/50': () => json(200, dmDetail(50, hanako)),
    ...routes,
  })
  renderAt(path)
  return fetch
}

const event = (type: string, conversationId: number, payload: object) =>
  ({ type, workspaceId: 3, conversationId, payload, sentAt: '2026-11-13T01:00:00Z' })

describe('サイドバーの DM（DM-1）', () => {
  it('チャンネルの下に、相手のアバター・表示名・ステータスの絵文字で DM を出し、押すと DM を開く', async () => {
    open('/w/3/c/10')
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: /general/ })

    expect(within(sidebar()).getByRole('heading', { level: 2, name: 'ダイレクトメッセージ' })).toBeInTheDocument()
    const links = within(sidebar()).getAllByRole('link', { name: /はなこ|じろう/ })
    expect(links.map((l) => l.textContent)).toEqual(['ははなこ 🏖', 'じじろう'])
    expect(links[0]).toHaveAttribute('href', '/w/3/d/50')

    await user.click(links[0])

    expect(location()).toHaveTextContent('/w/3/d/50')
  })

  it('DM の通知（メッセージが届いた）で、サイドバーの DM の先頭に足す', async () => {
    open('/w/3/c/10')
    await screen.findByRole('textbox', { name: 'メッセージ' })
    const client = Client.latest()
    await act(() => client.connect())
    const saburo = { ...jiro, username: 'saburo', displayName: 'さぶろう' }

    act(() => client.deliver(USER_EVENTS, event('conversation.updated', 52, dmSummary(52, saburo))))
    act(() => client.deliver(USER_EVENTS, event('conversation.updated', 51, dmSummary(51, jiro))))

    const names = within(sidebar()).getAllByRole('link', { name: /はなこ|じろう|さぶろう/ }).map((l) => l.textContent)
    expect(names).toEqual(['じじろう', 'ささぶろう', 'ははなこ 🏖'])
  })
})

describe('G-15 DM の相手の選択（DM-2、TC-12-1）', () => {
  it('自分以外のメンバーを出し、選ぶとその人との DM を開いてサイドバーに足す', async () => {
    const saburo = { ...jiro, username: 'saburo', displayName: 'さぶろう' }
    const fetch = open('/w/3/c/10', {
      'GET /api/workspaces/3/members': () => json(200, {
        items: [member(me, { role: 'OWNER' }), member(hanako), member(saburo)], nextCursor: null, memberCount: 3,
      }),
      'POST /api/workspaces/3/dms': () => json(201, dmDetail(52, saburo)),
      'GET /api/conversations/52': () => json(200, dmDetail(52, saburo)),
      'GET /api/conversations/52/messages': () => json(200, { items: [], hasMoreBefore: false, hasMoreAfter: false }),
      'POST /api/conversations/52/read': () => json(204),
    })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: /general/ })

    await user.click(within(sidebar()).getByRole('button', { name: 'ダイレクトメッセージを始める' }))
    const dialog = screen.getByRole('dialog', { name: 'ダイレクトメッセージを始める' })
    expect(within(dialog).getByRole('searchbox', { name: '名前で探す' })).toHaveFocus()
    await within(dialog).findByRole('button', { name: /さぶろう/ })
    expect(within(dialog).queryByRole('button', { name: /たろう/ })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /さぶろう/ }))

    await vi.waitFor(() => expect(location()).toHaveTextContent('/w/3/d/52'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/workspaces/3/dms'))).toEqual({ username: 'saburo' })
    expect(within(sidebar()).getByRole('link', { name: /さぶろう/ })).toHaveAttribute('href', '/w/3/d/52')
  })

  it('下までスクロールしたら続きの 50 人を読む', async () => {
    const fetch = open('/w/3/c/10', {
      'GET /api/workspaces/3/members': () => json(200, { items: people(0, 50), nextCursor: 'next', memberCount: 60 }),
      'GET /api/workspaces/3/members?cursor=next': () => json(200, { items: people(50, 10), nextCursor: null, memberCount: 60 }),
    })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: /general/ })
    await user.click(within(sidebar()).getByRole('button', { name: 'ダイレクトメッセージを始める' }))
    const list = (await screen.findByRole('button', { name: /@user0$/ })).closest('ul')!

    fireEvent.scroll(list)

    expect(await screen.findByRole('button', { name: /@user59$/ })).toBeInTheDocument()
    expect(fetch.keys()).toContain('GET /api/workspaces/3/members?cursor=next')
  })

  it('名前で探して、いなければ M-47 を出す', async () => {
    open('/w/3/c/10', {
      'GET /api/workspaces/3/members': () => json(200, { items: [member(hanako)], nextCursor: null, memberCount: 3 }),
      'GET /api/workspaces/3/members?q=zz': () => json(200, { items: [], nextCursor: null, memberCount: 3 }),
    })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: /general/ })
    await user.click(within(sidebar()).getByRole('button', { name: 'ダイレクトメッセージを始める' }))

    await user.type(screen.getByRole('searchbox', { name: '名前で探す' }), 'zz')

    expect(await screen.findByText(M[47])).toBeInTheDocument()
  })
})

describe('DM の会話（DM-5・DM-6）', () => {
  it('見出しに相手の表示名・@ユーザー ID・ステータスを出し、チャンネルの人数と ⓘ は出さない', async () => {
    open('/w/3/d/50')

    expect(await screen.findByRole('heading', { level: 1, name: /はなこ/ })).toHaveTextContent('はなこ@hanako')
    expect(screen.getByText('🏖 旅行中')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'チャンネルの詳細' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'メッセージ' })).toHaveAttribute('placeholder', 'はなこ へのメッセージ')
    // 会話の始まりは相手との DM の文
    expect(screen.getByText('はなこさんとのダイレクトメッセージはここから始まります。')).toBeInTheDocument()
    expect(screen.queryByText('このチャンネルはここから始まります。')).not.toBeInTheDocument()
  })

  it('相手がワークスペースにいなければ、入力欄の代わりに M-36 を出す', async () => {
    open('/w/3/d/50', { 'GET /api/conversations/50': () => json(200, dmDetail(50, hanako, { canPost: false })) })

    expect(await screen.findByText(M36('はなこ'))).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'メッセージ' })).not.toBeInTheDocument()
  })

  // TC-05-5
  it('開いている間に相手がキックされたら、すぐ M-36 に替わり、また参加したら入力欄に戻る（TC-12-6）', async () => {
    open('/w/3/d/50')
    await screen.findByRole('textbox', { name: 'メッセージ' })
    const client = Client.latest()
    await act(() => client.connect())

    act(() => client.deliver(USER_EVENTS, event('conversation.updated', 50, dmSummary(50, hanako, { canPost: false }))))
    expect(screen.getByText(M36('はなこ'))).toBeInTheDocument()

    act(() => client.deliver(USER_EVENTS, event('conversation.updated', 50, dmSummary(50, hanako))))
    expect(screen.getByRole('textbox', { name: 'メッセージ' })).toBeInTheDocument()
  })
})

describe('サイドバーの並べ直し', () => {
  it('チャンネルを足しても DM の並びは変えず、DM は DM の先頭に移す', () => {
    const list = [summary(10, 'general', { general: true }), summary(12, 'b'), dmSummary(50, hanako), dmSummary(51, jiro)] as ConversationSummary[]

    expect(upsertConversation(list, summary(13, 'a') as ConversationSummary).map((c) => c.id)).toEqual([10, 13, 12, 50, 51])
    expect(upsertConversation(list, dmSummary(51, jiro) as ConversationSummary).map((c) => c.id)).toEqual([10, 12, 51, 50])
  })
})
