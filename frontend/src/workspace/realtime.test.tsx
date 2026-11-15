import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearDrafts } from '../drafts'
import { M, M36 } from '../messages'
import { TOKEN_EXPIRED_CLOSE, conversationTopic } from '../realtime/connection'
import { Client } from '../test/fakeStomp'
import { json, mockFetch, type Handler } from '../test/fetchMock'
import { me } from '../test/render'
import { conversations, detail, opened, renderAt, summary, workspace } from '../test/workspace'

// G-5 のリアルタイムの通知（FN-07 MS-5・MS-16、機能定義書 4 章）。WebSocket は偽物（src/test/fakeStomp.ts）

const hanako = { username: 'hanako', displayName: 'はなこ', avatarUrl: null, statusEmoji: null, statusText: null }

const message = (id: number, body: string, extra: object = {}) => ({
  id, conversationId: 10, parentId: null, author: me, body, attachments: [], reactions: [], replyCount: 0, lastReplyAt: null, replyUsers: [],
  createdAt: '2026-11-11T01:00:00Z', editedAt: null, deleted: false, mine: true, canDelete: true, ...extra,
})

// 通知で届く形。mine・canDelete は false（機能定義書 4.3）
const event = (type: string, payload: object, conversationId = 10) =>
  ({ type, workspaceId: 3, conversationId, payload, sentAt: '2026-11-11T01:00:00Z' })
const fromHanako = (id: number, body: string, extra: object = {}) =>
  message(id, body, { author: hanako, mine: false, canDelete: false, ...extra })

const page = (items: object[], hasMoreBefore = false) => () => json(200, { items, hasMoreBefore, hasMoreAfter: false })

async function openGeneral(routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({ ...opened, ...routes })
  renderAt('/w/3/c/10')
  await screen.findByRole('textbox', { name: 'メッセージ' })
  const client = Client.latest()
  await act(() => client.connect())
  return { fetch, client }
}

function deliver(client: Client, body: object, conversationId = 10) {
  act(() => client.deliver(conversationTopic(conversationId), body))
}

const articles = () => screen.queryAllByRole('article')

afterEach(() => clearDrafts())

describe('通知の反映（MS-5、TC-07-3）', () => {
  it('開いている会話を購読し、ほかの人の送信を開き直さずに出す', async () => {
    const { client } = await openGeneral()
    expect(client.destinations()).toContain(conversationTopic(10))

    deliver(client, event('message.created', fromHanako(5, 'はなこから')))

    const item = (await screen.findByText('はなこから')).closest('article')!
    // ほかの人のものは編集できない。オーナー（テストのワークスペース）なので削除はできる
    expect(within(item).queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
    expect(within(item).getByRole('button', { name: '削除' })).toBeInTheDocument()
  })

  it('オーナーでなければ、ほかの人のメッセージは削除できない', async () => {
    const { client } = await openGeneral({ 'GET /api/workspaces/3': () => json(200, workspace({ role: 'MEMBER' })) })
    deliver(client, event('message.created', fromHanako(5, 'はなこから')))
    const item = (await screen.findByText('はなこから')).closest('article')!
    expect(within(item).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('自分が送ったものは、API の応答と通知の両方が届いても 1 つだけ出す（FN-07 5 章の 7）', async () => {
    let respond: ((res: Response) => void) | undefined
    const { client } = await openGeneral({
      'POST /api/conversations/10/messages': () => new Promise<Response>((resolve) => { respond = resolve }),
    })
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'メッセージ' }), 'こんにちは{Enter}')
    expect(screen.getByText('送信中…')).toBeInTheDocument()

    // 応答より先に通知が届く
    deliver(client, event('message.created', message(7, 'こんにちは', { mine: false, canDelete: false })))
    expect(screen.getAllByText('こんにちは')).toHaveLength(1)
    expect(screen.queryByText('送信中…')).not.toBeInTheDocument()

    await act(async () => respond?.(json(201, message(7, 'こんにちは'))))
    expect(screen.getAllByText('こんにちは')).toHaveLength(1)
    // 自分のものなので編集できる
    expect(within(articles()[0]).getByRole('button', { name: '編集' })).toBeInTheDocument()
  })

  it('同じ通知が 2 回届いても 1 つだけ出す', async () => {
    const { client } = await openGeneral()
    deliver(client, event('message.created', fromHanako(5, 'はなこから')))
    deliver(client, event('message.created', fromHanako(5, 'はなこから')))
    expect(screen.getAllByText('はなこから')).toHaveLength(1)
  })

  it('編集・「削除されました」・削除の通知を反映する', async () => {
    const { client } = await openGeneral({
      'GET /api/conversations/10/messages': page([fromHanako(1, '前の文'), fromHanako(2, '親')]),
    })
    await screen.findByText('前の文')

    deliver(client, event('message.updated', fromHanako(1, '直した文', { editedAt: '2026-11-11T01:01:00Z' })))
    expect(screen.getByText('直した文')).toBeInTheDocument()
    expect(screen.getByText('（編集済み）')).toBeInTheDocument()

    deliver(client, event('message.updated', fromHanako(2, '', { deleted: true, replyCount: 1 })))
    expect(screen.getByText(M[33])).toBeInTheDocument()

    deliver(client, event('message.deleted', { id: 1, parentId: null }))
    expect(screen.queryByText('直した文')).not.toBeInTheDocument()
  })

  it('ほかの会話の通知と、スレッドの返信は一覧に出さない', async () => {
    const { client } = await openGeneral()
    deliver(client, event('message.created', fromHanako(5, 'ほかの会話', { conversationId: 11 }), 11))
    deliver(client, event('message.created', fromHanako(6, '返信', { parentId: 1 })))
    expect(screen.queryByText('ほかの会話')).not.toBeInTheDocument()
    expect(screen.queryByText('返信')).not.toBeInTheDocument()
  })

  it('ほかの会話に移ったら、前の会話の購読をやめる（機能定義書 4.2）', async () => {
    const { client } = await openGeneral({
      'GET /api/conversations/11': () => json(200, detail(11, '運営', { visibility: 'PRIVATE' })),
      'POST /api/conversations/11/read': () => json(204),
    })
    await userEvent.setup().click(screen.getByRole('link', { name: /運営/ }))
    await screen.findByRole('heading', { level: 1, name: /運営/ })
    expect(client.destinations()).toContain(conversationTopic(11))
    expect(client.destinations()).not.toContain(conversationTopic(10))
  })
})

// jsdom は大きさを持たないので、一覧の高さとスクロールの位置を決める
function layout(list: HTMLElement, scrollTop: number) {
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 400 })
  list.scrollTop = scrollTop
  fireEvent.scroll(list)
}

async function openWithList() {
  const result = await openGeneral({ 'GET /api/conversations/10/messages': page([fromHanako(1, '最初')]) })
  const list = (await screen.findByText('最初')).closest('article')!.parentElement!
  return { ...result, list }
}

describe('「新しいメッセージ」（MS-5、TC-07-4）', () => {
  it('上の方を見ているときは下に送らず「新しいメッセージ」を出し、押すと下まで送る', async () => {
    const { client, list } = await openWithList()
    layout(list, 100)

    deliver(client, event('message.created', fromHanako(2, '届いた')))
    expect(list.scrollTop).toBe(100)
    const button = screen.getByRole('button', { name: '↓ 新しいメッセージ' })

    await userEvent.setup().click(button)
    expect(list.scrollTop).toBe(1000)
    expect(screen.queryByRole('button', { name: '↓ 新しいメッセージ' })).not.toBeInTheDocument()
  })

  it('いちばん下を見ているときは、下まで送ってボタンは出さない', async () => {
    const { client, list } = await openWithList()
    layout(list, 600)

    deliver(client, event('message.created', fromHanako(2, '届いた')))
    expect(list.scrollTop).toBe(1000)
    expect(screen.queryByRole('button', { name: '↓ 新しいメッセージ' })).not.toBeInTheDocument()
  })

  it('自分で下までスクロールしたらボタンを消す', async () => {
    const { client, list } = await openWithList()
    layout(list, 100)
    deliver(client, event('message.created', fromHanako(2, '届いた')))
    expect(screen.getByRole('button', { name: '↓ 新しいメッセージ' })).toBeInTheDocument()

    layout(list, 600)
    expect(screen.queryByRole('button', { name: '↓ 新しいメッセージ' })).not.toBeInTheDocument()
  })
})

describe('接続の状態とつなぎ直し（機能定義書 4.4、画面設計書 2.20）', () => {
  it('切れたら M-37 を出し、つなぎ直したら消して、サイドバーと最新の 50 件を取り直して置き換える', async () => {
    const { client, fetch } = await openGeneral({
      'GET /api/conversations/10/messages': [page([fromHanako(1, '前の文')]), page([fromHanako(1, '切れている間に直した'), fromHanako(2, '切れている間に来た')])],
      'GET /api/workspaces/3/conversations': [() => json(200, conversations),
        () => json(200, [...conversations, summary(12, '新しいチャンネル')])],
      'GET /api/auth/me': () => json(200, me),
    })
    await screen.findByText('前の文')

    act(() => client.drop())
    expect(screen.getByRole('alert')).toHaveTextContent(M[37])

    await act(() => client.connect())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // つなぎ直す前にログインを確かめる（JWT の期限が切れていれば取り直す）
    expect(fetch.keys()).toContain('GET /api/auth/me')
    expect(await screen.findByText('切れている間に来た')).toBeInTheDocument()
    expect(screen.getByText('切れている間に直した')).toBeInTheDocument()
    expect(screen.queryByText('前の文')).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /新しいチャンネル/ })).toBeInTheDocument()
    expect(client.destinations()).toContain(conversationTopic(10))
  })

  it('JWT の期限で切れたときは M-37 を出さない（TC-01-10）', async () => {
    const { client } = await openGeneral({ 'GET /api/auth/me': () => json(200, me) })
    act(() => client.drop(TOKEN_EXPIRED_CLOSE))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('つなぎ直したときに会話が見られなくなっていたら、M-27 を出して general に移す', async () => {
    const fetch = mockFetch({
      ...opened,
      'GET /api/conversations/11': [() => json(200, detail(11, '運営', { visibility: 'PRIVATE' })),
        () => json(404, { code: 'CONVERSATION_NOT_FOUND', message: M[27] })],
      'POST /api/conversations/11/read': () => json(204),
      'GET /api/auth/me': () => json(200, me),
    })
    renderAt('/w/3/c/11')
    await screen.findByRole('heading', { level: 1, name: /運営/ })
    const client = Client.latest()
    await act(() => client.connect())

    act(() => client.drop())
    await act(() => client.connect())

    expect(await screen.findByText(M[27])).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByRole('status', { name: '今の URL' })).toHaveTextContent('/w/3/c/10'))
    expect(fetch.keys()).toContain('GET /api/conversations/10')
  })
})

describe('送れない会話（MS-16）', () => {
  it('参加していない公開チャンネルでは、入力欄の代わりに M-30 を出す', async () => {
    mockFetch({ ...opened, 'GET /api/conversations/10': () => json(200, detail(10, 'general', { canPost: false, joined: false })) })
    renderAt('/w/3/c/10')
    expect(await screen.findByText(M[30])).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'メッセージ' })).not.toBeInTheDocument()
  })

  it('相手がワークスペースにいない DM では M-36 を出す', async () => {
    mockFetch({
      ...opened,
      'GET /api/conversations/10': () => json(200, detail(10, 'general', {
        type: 'DM', name: null, visibility: null, canPost: false, dmPartner: hanako,
      })),
    })
    renderAt('/w/3/c/10')
    expect(await screen.findByText(M36('はなこ'))).toBeInTheDocument()
  })
})
