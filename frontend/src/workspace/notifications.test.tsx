import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageView } from '../api'
import { clearDrafts } from '../drafts'
import { M } from '../messages'
import { notificationBody } from '../notifications/browserNotifications'
import NotificationSwitch from '../profile/NotificationSwitch'
import { USER_EVENTS, conversationTopic } from '../realtime/connection'
import { Client } from '../test/fakeStomp'
import { json, mockFetch, type Handler } from '../test/fetchMock'
import { me, renderComponent } from '../test/render'
import { detail, opened, renderAt, summary, workspace } from '../test/workspace'

// 通知（FN-14 NT-1〜NT-11）と、メッセージの位置を開く（FN-07 MS-14）・「新着」の線（MS-1）

const hanako = { username: 'hanako', displayName: 'はなこ', avatarUrl: null, statusEmoji: null, statusText: null }

const message = (id: number, body: string, extra: Partial<MessageView> = {}): MessageView => ({
  id, conversationId: 10, parentId: null, author: hanako, body, mentions: [], attachments: [], reactions: [],
  replyCount: 0, lastReplyAt: null, replyUsers: [], createdAt: '2026-11-11T01:00:00Z', editedAt: null, deleted: false,
  mine: false, canDelete: false, ...extra,
})

const page = (items: object[], extra: object = {}) => () =>
  json(200, { items, hasMoreBefore: false, hasMoreAfter: false, ...extra })

const event = (type: string, payload: object, conversationId: number | null = 10) =>
  ({ type, workspaceId: 3, conversationId, payload, sentAt: '2026-11-11T01:00:00Z' })

// 画面が見えているか（document.visibilityState）を変える
let visibility: DocumentVisibilityState = 'visible'
function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  clearDrafts()
  localStorage.clear()
  vi.unstubAllGlobals()
})

async function open(path: string, routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({ ...opened, ...routes })
  renderAt(path)
  await screen.findByRole('textbox', { name: 'メッセージ' })
  const client = Client.latest()
  await act(() => client.connect())
  return { fetch, client }
}

const readCalls = (fetch: ReturnType<typeof mockFetch>) =>
  fetch.calls.filter((c) => c.key === 'POST /api/conversations/10/read').map((c) => JSON.parse(String(c.init?.body)))

const item = (id: number, read: boolean, extra: object = {}) => ({
  message: message(id, `@taro_y ${id}`, { mentions: [{ username: 'taro_y', displayName: 'たろう' }] }),
  conversation: { id: 10, type: 'CHANNEL', name: 'general', dmPartner: null }, read, ...extra,
})

// Notification の偽物。出した通知を shown に残す
function fakeNotification(permission: NotificationPermission, answer: NotificationPermission = permission) {
  const shown: { title: string, options?: NotificationOptions, target: EventTarget }[] = []
  class FakeNotification extends EventTarget {
    static permission = permission
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = answer
      return answer
    })

    close = vi.fn()

    constructor(title: string, options?: NotificationOptions) {
      super()
      shown.push({ title, options, target: this })
    }
  }
  vi.stubGlobal('Notification', FakeNotification)
  return { shown, FakeNotification }
}

describe('サイドバー・ヘッダーの件数（NT-1・NT-2・NT-6、TC-14-1）', () => {
  // N-30
  it('未読の会話を太字にし、チャンネルはメンションの件数、DM は未読の件数を出す。「メンション」と「@」には合計', async () => {
    await open('/w/3/c/10', {
      'GET /api/workspaces/3': () => json(200, workspace({ hasUnread: true, mentionCount: 3 })),
      'GET /api/workspaces/3/conversations': () => json(200, [
        summary(10, 'general', { general: true }),
        summary(11, '旅行', { hasUnread: true, unreadCount: 4, mentionCount: 2 }),
        summary(50, null as unknown as string, {
          type: 'DM', visibility: null, dmPartner: hanako, hasUnread: true, unreadCount: 120, mentionCount: 1,
        }),
      ]),
    })
    const sidebar = screen.getByRole('navigation', { name: '会話' })
    const travel = within(sidebar).getByRole('link', { name: /旅行/ })
    expect(travel.className).toMatch(/unread/)
    expect(within(travel).getByLabelText('メンション 2 件')).toHaveTextContent('2')
    const dm = within(sidebar).getByRole('link', { name: /はなこ/ })
    expect(within(dm).getByLabelText('未読 120 件')).toHaveTextContent('99+')
    expect(within(sidebar).getByRole('link', { name: /^メンション/ })).toHaveTextContent('3')
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'メンション 3 件' })).toBeInTheDocument()
  })

  it('conversation.updated・workspace.updated で開き直さずに変える', async () => {
    const { client } = await open('/w/3/c/10')
    act(() => client.deliver(USER_EVENTS, event('conversation.updated',
      summary(11, '運営', { visibility: 'PRIVATE', hasUnread: true, unreadCount: 1, mentionCount: 1 }), 11)))
    act(() => client.deliver(USER_EVENTS, event('workspace.updated',
      { workspaceId: 3, hasUnread: true, mentionCount: 5 }, null)))
    const sidebar = screen.getByRole('navigation', { name: '会話' })
    expect(within(within(sidebar).getByRole('link', { name: /運営/ })).getByLabelText('メンション 1 件')).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'メンション 5 件' })).toBeInTheDocument()
  })
})

describe('読んだことにする（NT-4、TC-14-3・TC-14-4）', () => {
  it('開いたら最後のメッセージまで読んだことにし、見えている間に届いたものもすぐ読んだことにする', async () => {
    const { fetch, client } = await open('/w/3/c/10', {
      'GET /api/conversations/10/messages': page([message(1, '1'), message(2, '2')]),
    })
    await waitFor(() => expect(readCalls(fetch)).toEqual([{ lastMessageId: 2 }]))

    act(() => client.deliver(conversationTopic(10), event('message.created', message(3, '3'))))
    await waitFor(() => expect(readCalls(fetch).at(-1)).toEqual({ lastMessageId: 3 }))
  })

  it('タブを後ろにしている間に届いたものは未読のまま。前に来たら読んだことにする', async () => {
    const { fetch, client } = await open('/w/3/c/10', {
      'GET /api/conversations/10/messages': page([message(1, '1')]),
    })
    await waitFor(() => expect(readCalls(fetch)).toHaveLength(1))
    setVisibility('hidden')
    act(() => client.deliver(conversationTopic(10), event('message.created', message(2, '2'))))
    await screen.findByText('2')
    expect(readCalls(fetch)).toHaveLength(1)

    setVisibility('visible')
    await waitFor(() => expect(readCalls(fetch).at(-1)).toEqual({ lastMessageId: 2 }))
  })

  it('スレッドを開いたら、返信の中のメンションを読んだことにする', async () => {
    const { fetch } = await open('/w/3/c/10?thread=1', {
      'GET /api/conversations/10/messages': page([message(1, '親', { replyCount: 1 })]),
      'GET /api/messages/1/replies': () => json(200, {
        parent: message(1, '親', { replyCount: 1 }), items: [message(2, '返信', { parentId: 1 })],
        hasMoreBefore: false, hasMoreAfter: false,
      }),
      'POST /api/messages/1/thread-read': () => json(204),
    })
    await waitFor(() => expect(fetch.keys()).toContain('POST /api/messages/1/thread-read'))
  })
})

describe('「新着」の線（MS-1）', () => {
  // TC-07-8
  it('最後に読んだものより後の、ほかの人のメッセージの上に出す', async () => {
    await open('/w/3/c/10', {
      'GET /api/conversations/10': () => json(200, detail(10, 'general', { general: true, lastReadMessageId: 1 })),
      'GET /api/conversations/10/messages': page([
        message(1, '読んだ'), message(2, '自分の', { author: me, mine: true }), message(3, '新しい'),
      ]),
    })
    const line = await screen.findByRole('separator', { name: 'ここから新着' })
    const items = screen.getAllByRole('article')
    expect(line.compareDocumentPosition(items[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(line.compareDocumentPosition(items[1]) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('未読がなければ出さない', async () => {
    await open('/w/3/c/10', {
      'GET /api/conversations/10': () => json(200, detail(10, 'general', { general: true, lastReadMessageId: 2 })),
      'GET /api/conversations/10/messages': page([message(1, '1'), message(2, '2')]),
    })
    await screen.findByText('2')
    expect(screen.queryByRole('separator', { name: 'ここから新着' })).not.toBeInTheDocument()
  })
})

describe('メッセージの位置を開く（MS-14）', () => {
  // TC-07-13
  it('前後を読み込んでそのメッセージを目立たせ、URL から外す。下まで来たら後ろを読む', async () => {
    const { fetch } = await open('/w/3/c/10?message=5', {
      'GET /api/conversations/10/messages?around=5': page([message(4, '前'), message(5, 'これ'), message(6, '後')],
        { hasMoreAfter: true }),
      'GET /api/conversations/10/messages?after=6': page([message(7, 'もっと後')]),
    })
    const target = (await screen.findByText('これ')).closest('article')!
    expect(target.className).toMatch(/highlight/)
    await waitFor(() => expect(screen.getByRole('status', { name: '今の URL' })).toHaveTextContent(/^\/w\/3\/c\/10$/))
    expect(fetch.keys()).not.toContain('GET /api/conversations/10/messages')

    const list = target.parentElement!
    fireEvent.scroll(list)
    expect(await screen.findByText('もっと後')).toBeInTheDocument()
  })

  it('後ろが残っている間は、届いたメッセージを足さない', async () => {
    const { client } = await open('/w/3/c/10?message=5', {
      'GET /api/conversations/10/messages?around=5': page([message(5, 'これ')], { hasMoreAfter: true }),
    })
    await screen.findByText('これ')
    act(() => client.deliver(conversationTopic(10), event('message.created', message(99, '新着'))))
    expect(screen.queryByText('新着')).not.toBeInTheDocument()
  })

  it('スレッドの返信なら、親を目立たせてスレッドのパネルも開く', async () => {
    await open('/w/3/c/10?message=8', {
      'GET /api/conversations/10/messages?around=8': page([message(5, '親', { replyCount: 1 })]),
      'GET /api/messages/8': () => json(200, message(8, '返信', { parentId: 5 })),
      'GET /api/messages/5/replies': () => json(200, {
        parent: message(5, '親', { replyCount: 1 }), items: [message(8, '返信', { parentId: 5 })],
        hasMoreBefore: false, hasMoreAfter: false,
      }),
      'POST /api/messages/5/thread-read': () => json(204),
    })
    expect(await screen.findByRole('complementary', { name: 'スレッド' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '今の URL' })).toHaveTextContent('/w/3/c/10?thread=5')
    const parents = screen.getAllByText('親').map((el) => el.closest('article')!)
    expect(parents[0].className).toMatch(/highlight/)
  })

  it('メッセージがもうなければ最新を開く', async () => {
    await open('/w/3/c/10?message=5', {
      'GET /api/conversations/10/messages?around=5': () => json(404, { code: 'MESSAGE_NOT_FOUND', message: M[49] }),
      'GET /api/conversations/10/messages': page([message(9, '最新')]),
    })
    expect(await screen.findByText('最新')).toBeInTheDocument()
  })
})

describe('G-7 メンション一覧画面（NT-5、TC-14-6）', () => {
  it('新しい順に出し、読んでいないものに印を付け、押すと G-5 でその位置を開く', async () => {
    mockFetch({
      ...opened,
      'GET /api/workspaces/3/mentions': () => json(200, { items: [item(2, false), item(1, true)], nextCursor: null }),
      'GET /api/conversations/10/messages?around=2': page([message(2, '@taro_y 2')]),
    })
    renderAt('/w/3/mentions')
    const unread = await screen.findByRole('button', { name: /^未読.*# general.*@taro_y 2$/ })
    expect(screen.getByRole('button', { name: /^# general.*@taro_y 1$/ })).toBeInTheDocument()

    await userEvent.setup().click(unread)
    expect(await screen.findByRole('textbox', { name: 'メッセージ' })).toBeInTheDocument()
    expect(await screen.findByText('@taro_y 2')).toBeInTheDocument()
  })

  it('1 件もなければ M-45', async () => {
    mockFetch({ ...opened, 'GET /api/workspaces/3/mentions': () => json(200, { items: [], nextCursor: null }) })
    renderAt('/w/3/mentions')
    expect(await screen.findByText(M[45])).toBeInTheDocument()
  })

  it('開いている間にメンションされたら、いちばん上に足す', async () => {
    mockFetch({ ...opened, 'GET /api/workspaces/3/mentions': () => json(200, { items: [item(1, true)], nextCursor: null }) })
    renderAt('/w/3/mentions')
    await screen.findByRole('button', { name: /@taro_y 1$/ })
    const client = Client.latest()
    await act(() => client.connect())
    act(() => client.deliver(USER_EVENTS, event('notify',
      { kind: 'MENTION', message: message(5, '@taro_y 新しい'), conversationName: '#general' })))
    const rows = within(screen.getByRole('main')).getAllByRole('button', { name: /# general/ })
    expect(rows[0]).toHaveAccessibleName(/^未読/)
    expect(rows[0]).toHaveTextContent('@taro_y 新しい')
  })
})

describe('ブラウザの通知（NT-7〜NT-9、TC-14-8〜11）', () => {
  it('本文は記号を取り除き、改行を空白にして 50 文字まで。添付だけなら「画像・動画を送りました」', () => {
    expect(notificationBody({ body: '**土曜**の\n> 集合は `駅前`', attachments: [] })).toBe('土曜の 集合は 駅前')
    expect(notificationBody({ body: 'あ'.repeat(60), attachments: [] })).toBe('あ'.repeat(50))
    // ユーザー ID の「_」は残す
    expect(notificationBody({ body: '_斜体_ と @taro_y', attachments: [] })).toBe('斜体 と @taro_y')
    expect(notificationBody({ body: '', attachments: [{} as never] })).toBe('画像・動画を送りました')
  })

  it('オンにすると許可を求め、拒否されたら M-46 を出してオフのまま', async () => {
    const { FakeNotification } = fakeNotification('default', 'denied')
    renderComponent(<NotificationSwitch />)
    const toggle = screen.getByRole('switch', { name: 'ブラウザの通知' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await userEvent.setup().click(toggle)
    expect(FakeNotification.requestPermission).toHaveBeenCalled()
    expect(await screen.findByText(M[46])).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('許可されたらオンにし、このブラウザに覚える。もう一度押すとオフ', async () => {
    fakeNotification('default', 'granted')
    renderComponent(<NotificationSwitch />)
    const user = userEvent.setup()
    const toggle = screen.getByRole('switch', { name: 'ブラウザの通知' })
    await user.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    expect(localStorage.getItem('raisechat.browserNotifications')).toBe('on')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('オンなら、メンションで表示名・会話の名前・本文の通知を出し、押すとそのメッセージを開く', async () => {
    const { shown } = fakeNotification('granted')
    localStorage.setItem('raisechat.browserNotifications', 'on')
    const { client } = await open('/w/3/c/11', {
      'GET /api/conversations/11': () => json(200, detail(11, '運営', { visibility: 'PRIVATE' })),
      'GET /api/conversations/10/messages?around=7': page([message(7, '@taro_y 見て')]),
    })
    act(() => client.deliver(USER_EVENTS, event('notify',
      { kind: 'MENTION', message: message(7, '@taro_y 見て'), conversationName: '#general' })))
    expect(shown).toHaveLength(1)
    expect(shown[0].title).toBe('はなこ（#general）')
    expect(shown[0].options).toEqual({ body: '@taro_y 見て', tag: '7' })

    act(() => shown[0].target.dispatchEvent(new Event('click')))
    expect(await screen.findByText('@taro_y 見て')).toBeInTheDocument()
  })

  it('その会話を開いて見ているときと、オフのときは出さない', async () => {
    const { shown } = fakeNotification('granted')
    localStorage.setItem('raisechat.browserNotifications', 'on')
    const { client } = await open('/w/3/c/10')
    act(() => client.deliver(USER_EVENTS, event('notify',
      { kind: 'MENTION', message: message(7, '見て'), conversationName: '#general' })))
    expect(shown).toHaveLength(0)

    // 見えていなければ出す
    setVisibility('hidden')
    act(() => client.deliver(USER_EVENTS, event('notify',
      { kind: 'MENTION', message: message(8, '見て'), conversationName: '#general' })))
    expect(shown).toHaveLength(1)

    localStorage.removeItem('raisechat.browserNotifications')
    act(() => client.deliver(USER_EVENTS, event('notify',
      { kind: 'DM', message: message(9, 'DM', { conversationId: 50 }), conversationName: 'DM' }, 50)))
    expect(shown).toHaveLength(1)
  })
})

describe('G-3 の印（NT-3、TC-14-5）', () => {
  it('workspace.updated で開き直さずに太字と件数を変える', async () => {
    const { default: WorkspacesPage } = await import('../pages/WorkspacesPage')
    mockFetch({ 'GET /api/workspaces': () => json(200, [workspace()]) })
    const { RealtimeProvider } = await import('../realtime/RealtimeProvider')
    renderComponent(<RealtimeProvider><WorkspacesPage /></RealtimeProvider>)
    const row = await screen.findByRole('link', { name: /仲間うち/ })
    const client = Client.latest()
    await act(() => client.connect())
    act(() => client.deliver(USER_EVENTS, event('workspace.updated',
      { workspaceId: 3, hasUnread: true, mentionCount: 2 }, null)))
    expect(row.className).toMatch(/unread/)
    expect(within(row).getByLabelText('メンション 2 件')).toBeInTheDocument()
  })
})

