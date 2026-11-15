import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { MessageView } from '../api'
import { clearDrafts } from '../drafts'
import { M, M44 } from '../messages'
import { json, mockFetch, type Handler } from '../test/fetchMock'
import { opened, renderAt } from '../test/workspace'

// メッセージ検索（FN-13 SR-1〜SR-8、画面設計書 2.6・8 章）

const hanako = { username: 'hanako', displayName: 'はなこ', avatarUrl: null, statusEmoji: null, statusText: null }

const message = (id: number, body: string, extra: Partial<MessageView> = {}): MessageView => ({
  id, conversationId: 10, parentId: null, author: hanako, body, mentions: [], attachments: [], reactions: [],
  replyCount: 0, lastReplyAt: null, replyUsers: [], createdAt: '2026-11-11T01:00:00Z', editedAt: null, deleted: false,
  mine: false, canDelete: false, ...extra,
})

const general = { id: 10, type: 'CHANNEL', name: 'general', dmPartner: null }
const result = (m: MessageView, conversation: object = general) => ({ message: m, conversation })

const channels = () => json(200, {
  items: [{ id: 10, name: 'general', description: null, visibility: 'PUBLIC', memberCount: 2, joined: true },
    { id: 12, name: '旅行', description: null, visibility: 'PUBLIC', memberCount: 1, joined: false }],
  nextCursor: null,
})
const members = () => json(200, { items: [{ ...hanako, role: 'MEMBER', joinedAt: '2026-11-11T00:00:00Z', statusExpiresAt: null }], nextCursor: null })

const searchRoutes = {
  'GET /api/workspaces/3/channels': channels,
  'GET /api/workspaces/3/members?q=': members,
  'GET /api/workspaces/3/members?q=hanako': members,
}

function open(path: string, routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({ ...opened, ...searchRoutes, ...routes })
  renderAt(path)
  return fetch
}

const encode = (q: string) => new URLSearchParams({ q }).toString()

afterEach(() => clearDrafts())

describe('ヘッダーの検索欄（SR-1・SR-7、画面設計書 2.6）', () => {
  it('Enter で G-6 を開いて結果を出し、G-6 では検索した文字を入れておく', async () => {
    open('/w/3/c/10', {
      [`GET /api/workspaces/3/search?${encode('集合 駅前')}`]: () => json(200, { items: [result(message(1, '集合は駅前'))], nextCursor: null }),
    })
    const user = userEvent.setup()
    const box = await screen.findByRole('searchbox', { name: 'メッセージを検索' })
    await user.type(box, ' 集合 駅前 {Enter}')

    expect(await screen.findByRole('heading', { name: '「集合 駅前」の検索結果' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '今の URL' })).toHaveTextContent(`/w/3/search?${encode('集合 駅前')}`)
    expect(screen.getByRole('searchbox', { name: 'メッセージを検索' })).toHaveValue('集合 駅前')
  })

  it('空のまま Enter は M-43。100 文字より後は入らない', async () => {
    open('/w/3/c/10')
    const user = userEvent.setup()
    const box = await screen.findByRole('searchbox', { name: 'メッセージを検索' })
    await user.type(box, '   {Enter}')
    expect(await screen.findByText(M[43])).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'あ'.repeat(101) } })
    expect(box).toHaveValue('あ'.repeat(100))
  })
})

describe('G-6 検索結果画面（SR-1〜SR-6）', () => {
  it('会話の名前・スレッドの返信の印・送った人・本文（一致した言葉を目立たせる）・添付の数を出す', async () => {
    open(`/w/3/search?${encode('集合')}`, {
      [`GET /api/workspaces/3/search?${encode('集合')}`]: () => json(200, {
        items: [
          result(message(3, '返信で集合', { parentId: 1 })),
          result(message(2, 'DM で集合', { conversationId: 50, attachments: [{} as never, {} as never] }),
            { id: 50, type: 'DM', name: null, dmPartner: hanako }),
        ],
        nextCursor: null,
      }),
    })
    const rows = await screen.findAllByRole('button', { name: /集合/ })
    expect(rows[0]).toHaveTextContent('# general')
    expect(rows[0]).toHaveTextContent('スレッドの返信')
    expect(within(rows[0]).getByText('集合', { selector: 'mark' })).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('DM：はなこ')
    expect(within(rows[1]).getByLabelText('添付 2 個')).toBeInTheDocument()
  })

  it('0 件は M-44、失敗は M-48 と「再読み込み」', async () => {
    open(`/w/3/search?${encode('ない')}`, {
      [`GET /api/workspaces/3/search?${encode('ない')}`]: [
        () => json(500, { code: 'INTERNAL_ERROR', message: M[49] }),
        () => json(200, { items: [], nextCursor: null }),
      ],
    })
    expect(await screen.findByText(M[48])).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '再読み込み' }))
    expect(await screen.findByText(M44('ない'))).toBeInTheDocument()
  })

  it('下までスクロールすると次の 20 件を読む（TC-13-8）', async () => {
    const fetch = open(`/w/3/search?${encode('予定')}`, {
      [`GET /api/workspaces/3/search?${encode('予定')}`]: () => json(200, { items: [result(message(30, '予定 30'))], nextCursor: '30' }),
      [`GET /api/workspaces/3/search?${encode('予定')}&cursor=30`]: () => json(200, { items: [result(message(5, '予定 5'))], nextCursor: null }),
    })
    const first = await screen.findByRole('button', { name: /予定 30/ })
    fireEvent.scroll(first.closest('ul')!.parentElement!)
    expect(await screen.findByRole('button', { name: /予定 5/ })).toBeInTheDocument()
    expect(fetch.keys()).toContain(`GET /api/workspaces/3/search?${encode('予定')}&cursor=30`)
  })

  it('会話と送った人で絞り込むと、URL を変えて読み直す（SR-5）', async () => {
    const fetch = open(`/w/3/search?${encode('予定')}`, {
      [`GET /api/workspaces/3/search?${encode('予定')}`]: () => json(200, { items: [result(message(1, '予定 1'))], nextCursor: null }),
      [`GET /api/workspaces/3/search?${encode('予定')}&conversationId=12`]: () => json(200, { items: [], nextCursor: null }),
      [`GET /api/workspaces/3/search?${encode('予定')}&conversationId=12&from=hanako`]: () => json(200, { items: [result(message(9, '予定 9'))], nextCursor: null }),
    })
    await screen.findByRole('button', { name: /予定 1/ })
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByRole('combobox', { name: '会話：' }), '12')
    expect(await screen.findByText(M44('予定'))).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '今の URL' })).toHaveTextContent('conversation=12')

    await user.type(screen.getByRole('combobox', { name: '送った人：' }), 'hanako{Enter}')
    expect(await screen.findByRole('button', { name: /予定 9/ })).toBeInTheDocument()
    expect(fetch.keys()).toContain(`GET /api/workspaces/3/search?${encode('予定')}&conversationId=12&from=hanako`)
  })

  it('結果を押すと、G-5 でそのメッセージの位置を開く（SR-6、TC-13-6）', async () => {
    open(`/w/3/search?${encode('集合')}`, {
      [`GET /api/workspaces/3/search?${encode('集合')}`]: () => json(200, { items: [result(message(7, '集合は駅前'))], nextCursor: null }),
      'GET /api/conversations/10/messages?around=7': () => json(200, {
        items: [message(7, '集合は駅前')], hasMoreBefore: false, hasMoreAfter: false,
      }),
    })
    await userEvent.setup().click(await screen.findByRole('button', { name: /集合は駅前/ }))
    const article = (await screen.findByRole('article', { name: 'はなこのメッセージ' }))
    expect(article.className).toMatch(/highlight/)
    await waitFor(() => expect(screen.getByRole('status', { name: '今の URL' })).toHaveTextContent(/^\/w\/3\/c\/10$/))
  })
})
