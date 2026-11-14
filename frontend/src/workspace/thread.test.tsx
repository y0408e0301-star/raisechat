import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageView } from '../api'
import { clearDrafts } from '../drafts'
import { M } from '../messages'
import { conversationTopic } from '../realtime/connection'
import { Client } from '../test/fakeStomp'
import { json, mockFetch, sentJson, type Handler } from '../test/fetchMock'
import { me } from '../test/render'
import { detail, opened, renderAt } from '../test/workspace'

// スレッド（FN-08 TH-1〜TH-8、画面設計書 7.2）

const hanako = { username: 'hanako', displayName: 'はなこ', avatarUrl: null, statusEmoji: null, statusText: null }
const jiro = { username: 'jiro', displayName: 'じろう', avatarUrl: null, statusEmoji: null, statusText: null }

const message = (id: number, body: string, extra: Partial<MessageView> = {}): MessageView => ({
  id, conversationId: 10, parentId: null, author: me, body, attachments: [], replyCount: 0, lastReplyAt: null,
  replyUsers: [], createdAt: '2026-11-11T01:00:00Z', editedAt: null, deleted: false, mine: true, canDelete: true,
  ...extra,
})
const reply = (id: number, body: string, extra: Partial<MessageView> = {}) =>
  message(id, body, { parentId: 1, author: hanako, mine: false, canDelete: false, ...extra })

const parent = (extra: Partial<MessageView> = {}) => message(1, '旅行の計画', {
  replyCount: 2, lastReplyAt: '2026-11-11T01:07:00Z', replyUsers: [hanako, jiro], ...extra,
})

const page = (items: object[]) => () => json(200, { items, hasMoreBefore: false, hasMoreAfter: false })
const thread = (items: MessageView[], extra: object = {}) => () =>
  json(200, { parent: parent(), items, hasMoreBefore: false, hasMoreAfter: false, ...extra })

const event = (type: string, payload: object) =>
  ({ type, workspaceId: 3, conversationId: 10, payload, sentAt: '2026-11-11T01:00:00Z' })

const location = () => screen.getByRole('status', { name: '今の URL' })
const panel = () => screen.getByRole('complementary', { name: 'スレッド' })

async function open(path: string, routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({
    ...opened,
    'GET /api/conversations/10/messages': page([parent()]),
    'GET /api/messages/1/replies': thread([reply(2, '行きたい'), reply(3, '私も', { author: jiro })]),
    ...routes,
  })
  renderAt(path)
  await screen.findAllByText('旅行の計画')
  const client = Client.latest()
  await act(() => client.connect())
  return { fetch, client }
}

afterEach(() => {
  clearDrafts()
  vi.useRealTimers()
})

describe('親メッセージの返信の件数（TH-2）', () => {
  it('返信した人のアバター・件数・最後の時刻を出し、押すとスレッドのパネルを開いて URL に入れる', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-11T03:00:00Z'), shouldAdvanceTime: true })
    await open('/w/3/c/10')
    const user = userEvent.setup()

    const button = screen.getByRole('button', { name: /2 件の返信/ })
    expect(button).toHaveTextContent('はじ2 件の返信最終 10:07')
    await user.click(button)

    expect(location()).toHaveTextContent('/w/3/c/10?thread=1')
    expect(await within(panel()).findByText('行きたい')).toBeInTheDocument()
    expect(within(panel()).getByText('旅行の計画')).toBeInTheDocument()
    expect(within(panel()).getByText('2 件の返信')).toBeInTheDocument()
    // パネルの中には「スレッドで返信」も返信の件数の行も出さない（TH-5）
    expect(within(panel()).queryByRole('button', { name: 'スレッドで返信' })).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: /件の返信/ })).not.toBeInTheDocument()
    // 返信は会話の一覧には出さない
    expect(screen.getAllByText('行きたい')).toHaveLength(1)
  })

  it('メッセージの「スレッドで返信」でも開く（TH-1）', async () => {
    await open('/w/3/c/10', { 'GET /api/conversations/10/messages': page([parent({ replyCount: 0, replyUsers: [] })]) })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'スレッドで返信' }))

    expect(location()).toHaveTextContent('?thread=1')
    expect(await within(panel()).findByText('旅行の計画')).toBeInTheDocument()
  })
})

describe('スレッドのパネル（TH-3〜TH-8）', () => {
  // TC-08-6
  it('?thread= の URL を開くとパネルを開いたままにし、「✕」で閉じて URL からも外す', async () => {
    await open('/w/3/c/10?thread=1')
    const user = userEvent.setup()
    expect(await within(panel()).findByText('私も')).toBeInTheDocument()

    await user.click(within(panel()).getByRole('button', { name: 'スレッドを閉じる' }))

    expect(screen.queryByRole('complementary', { name: 'スレッド' })).not.toBeInTheDocument()
    expect(location()).toHaveTextContent(/^\/w\/3\/c\/10$/)
  })

  it('返信を送ると、送信中を出してから返信に替える', async () => {
    const { fetch } = await open('/w/3/c/10?thread=1', {
      'POST /api/messages/1/replies': () => json(201, reply(4, '日程は？', { author: me, mine: true, canDelete: true })),
    })
    const user = userEvent.setup()
    const input = await within(panel()).findByRole('textbox', { name: 'メッセージ' })
    expect(input).toHaveAttribute('placeholder', '返信する…')

    await user.type(input, '日程は？{Enter}')

    expect(await within(panel()).findByText('日程は？')).toBeInTheDocument()
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/messages/1/replies')))
      .toMatchObject({ body: '日程は？', attachmentIds: [] })
  })

  // TC-08-1
  it('ほかの人の返信と親の件数の変化を、開き直さずに出す', async () => {
    const { client } = await open('/w/3/c/10?thread=1')
    await within(panel()).findByText('私も')

    act(() => client.deliver(conversationTopic(10), event('message.created', reply(4, '新しい返信'))))
    act(() => client.deliver(conversationTopic(10), event('message.updated',
      parent({ replyCount: 3, mine: false, canDelete: false }))))

    expect(within(panel()).getByText('新しい返信')).toBeInTheDocument()
    expect(within(panel()).getByText('3 件の返信')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /3 件の返信/ })).toBeInTheDocument()
    // 返信は会話の一覧には足さない
    expect(screen.getAllByText('新しい返信')).toHaveLength(1)
  })

  // TC-08-5（TH-7）
  it('親メッセージが消えたらパネルを閉じる', async () => {
    const { client } = await open('/w/3/c/10?thread=1')
    await within(panel()).findByText('私も')

    act(() => client.deliver(conversationTopic(10), event('message.deleted', { id: 1, parentId: null })))

    expect(screen.queryByRole('complementary', { name: 'スレッド' })).not.toBeInTheDocument()
  })

  it('返信が消えたらパネルから消す', async () => {
    const { client } = await open('/w/3/c/10?thread=1')
    await within(panel()).findByText('私も')

    act(() => client.deliver(conversationTopic(10), event('message.deleted', { id: 3, parentId: 1 })))

    expect(within(panel()).queryByText('私も')).not.toBeInTheDocument()
  })

  it('親メッセージがもうなければ M-49 を出して閉じる', async () => {
    await open('/w/3/c/10?thread=1', {
      'GET /api/messages/1/replies': () => json(404, { code: 'MESSAGE_NOT_FOUND', message: M[49] }),
    })

    expect(await screen.findByText(M[49])).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'スレッド' })).not.toBeInTheDocument()
  })

  // TC-08-7（TH-8）
  it('送れない会話では、入力欄の代わりに M-30 を出す', async () => {
    await open('/w/3/c/10?thread=1', {
      'GET /api/conversations/10': () => json(200, detail(10, 'general', { general: true, canPost: false, joined: false })),
    })

    expect(await within(panel()).findByText(M[30])).toBeInTheDocument()
    expect(within(panel()).queryByRole('textbox', { name: 'メッセージ' })).not.toBeInTheDocument()
  })

  // TC-08-8
  it('上まで戻ると前の返信を読む', async () => {
    const { fetch } = await open('/w/3/c/10?thread=1', {
      'GET /api/messages/1/replies': thread([reply(52, '52 件目')], { hasMoreBefore: true }),
      'GET /api/messages/1/replies?before=52': thread([reply(2, '2 件目')]),
    })
    await within(panel()).findByText('52 件目')

    const list = within(panel()).getByText('52 件目').closest('article')!.parentElement!
    list.scrollTop = 0
    fireEvent.scroll(list)

    expect(await within(panel()).findByText('2 件目')).toBeInTheDocument()
    expect(fetch.keys()).toContain('GET /api/messages/1/replies?before=52')
  })
})
