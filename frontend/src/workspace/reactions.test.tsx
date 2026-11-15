import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageView, ReactionView } from '../api'
import { clearDrafts } from '../drafts'
import { M } from '../messages'
import { conversationTopic } from '../realtime/connection'
import { Client } from '../test/fakeStomp'
import { json, mockFetch, type Handler } from '../test/fetchMock'
import { me } from '../test/render'
import { detail, opened, renderAt } from '../test/workspace'
import { reactionsForViewer } from './liveMessages'
import { reactorNames, toggled } from './reactionState'

// G-5 のリアクション（FN-10 RE-1〜RE-7、画面設計書 2.11）

// 絵文字の一覧（emoji-picker-element）は jsdom では動かないので、選ぶボタンだけの偽物にする。
// 本物と同じく、👍 は異体字セレクタ（U+FE0F）付きで返す
vi.mock('../components/EmojiPicker', () => ({
  default: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <dialog open aria-label="絵文字の一覧">
      <button type="button" onClick={() => onSelect('👍️')}>👍</button>
      <button type="button" onClick={() => onSelect('🎉')}>🎉</button>
    </dialog>
  ),
}))

const hanako = { username: 'hanako', displayName: 'はなこ' }
const jiro = { username: 'jiro', displayName: 'じろう' }
const taro = { username: me.username, displayName: me.displayName }

const reaction = (emoji: string, users: { username: string, displayName: string }[], extra: Partial<ReactionView> = {}) =>
  ({ emoji, count: users.length, reactedByMe: users.some((u) => u.username === me.username), users, ...extra })

const message = (id: number, body: string, extra: Partial<MessageView> = {}): MessageView => ({
  id, conversationId: 10, parentId: null, author: { ...me, ...hanako }, body, mentions: [], attachments: [], reactions: [],
  replyCount: 0, lastReplyAt: null, replyUsers: [], createdAt: '2026-11-11T01:00:00Z', editedAt: null, deleted: false,
  mine: false, canDelete: true, ...extra,
})

const page = (items: object[]) => () => json(200, { items, hasMoreBefore: false, hasMoreAfter: false })

const event = (type: string, payload: object) =>
  ({ type, workspaceId: 3, conversationId: 10, payload, sentAt: '2026-11-11T01:00:00Z' })

async function open(items: MessageView[], routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({ ...opened, 'GET /api/conversations/10/messages': page(items), ...routes })
  renderAt('/w/3/c/10')
  await screen.findByText(items[0].body)
  const client = Client.latest()
  await act(() => client.connect())
  return { fetch, client }
}

const article = (body: string) => screen.getByText(body).closest('article')!
const list = (body: string) => within(article(body)).getByRole('list', { name: 'リアクション' })
const chip = (body: string, name: string | RegExp) => within(list(body)).getByRole('button', { name })

afterEach(() => clearDrafts())

describe('リアクションの表示（RE-2・RE-5）', () => {
  it('絵文字と件数を並べ、自分が付けたものは押した状態で「自分も付けた」と読む', async () => {
    await open([message(1, '土曜の集合', {
      reactions: [reaction('👍', [hanako, taro]), reaction('🎉', [jiro])],
    })])
    const mine = chip('土曜の集合', '👍 2 件、自分も付けた')
    expect(mine).toHaveAttribute('aria-pressed', 'true')
    expect(chip('土曜の集合', '🎉 1 件')).toHaveAttribute('aria-pressed', 'false')
    // 並びの最後に「＋」
    const buttons = within(list('土曜の集合')).getAllByRole('button')
    expect(buttons.at(-1)).toHaveAccessibleName('リアクションを付ける')
  })

  it('リアクションがなければ並びを出さない', async () => {
    await open([message(1, '何もない')])
    expect(within(article('何もない')).queryByRole('list', { name: 'リアクション' })).not.toBeInTheDocument()
  })
})

describe('付ける・外す（RE-1・RE-3、TC-10-1）', () => {
  it('並んでいる絵文字を押すと、応答を待たずに付け、もう一度押すと外す', async () => {
    let respond: ((res: Response) => void) | undefined
    const { fetch } = await open([message(1, '土曜の集合', { reactions: [reaction('🎉', [jiro])] })], {
      'PUT /api/messages/1/reactions/%F0%9F%8E%89': () => new Promise<Response>((resolve) => { respond = resolve }),
      'DELETE /api/messages/1/reactions/%F0%9F%8E%89': () => json(200, { reactions: [reaction('🎉', [jiro])] }),
    })
    const user = userEvent.setup()

    await user.click(chip('土曜の集合', '🎉 1 件'))
    // 応答の前に、件数が増えて押した状態になる
    expect(chip('土曜の集合', '🎉 2 件、自分も付けた')).toHaveAttribute('aria-pressed', 'true')
    await act(async () => respond?.(json(200, { reactions: [reaction('🎉', [jiro, taro])] })))

    await user.click(chip('土曜の集合', '🎉 2 件、自分も付けた'))
    expect(chip('土曜の集合', '🎉 1 件')).toHaveAttribute('aria-pressed', 'false')
    expect(fetch.keys()).toEqual(expect.arrayContaining([
      'PUT /api/messages/1/reactions/%F0%9F%8E%89', 'DELETE /api/messages/1/reactions/%F0%9F%8E%89',
    ]))
  })

  it('最後の 1 人が外すと、その絵文字は消える', async () => {
    await open([message(1, '土曜の集合', { reactions: [reaction('🎉', [taro])] })], {
      'DELETE /api/messages/1/reactions/%F0%9F%8E%89': () => json(200, { reactions: [] }),
    })
    await userEvent.setup().click(chip('土曜の集合', '🎉 1 件、自分も付けた'))
    expect(within(article('土曜の集合')).queryByRole('list', { name: 'リアクション' })).not.toBeInTheDocument()
  })

  it('メッセージの操作の「リアクション」から絵文字の一覧で選ぶと付ける。U+FE0F 付きでも同じ絵文字にまとめる', async () => {
    const { fetch } = await open([message(1, '土曜の集合', { reactions: [reaction('👍', [hanako])] })], {
      'PUT /api/messages/1/reactions/%F0%9F%91%8D%EF%B8%8F': () =>
        json(200, { reactions: [reaction('👍', [hanako, taro])] }),
    })
    const user = userEvent.setup()
    await user.click(within(article('土曜の集合')).getByRole('button', { name: 'リアクション' }))
    await user.click(within(await screen.findByRole('dialog', { name: '絵文字の一覧' })).getByRole('button', { name: '👍' }))

    expect(screen.queryByRole('dialog', { name: '絵文字の一覧' })).not.toBeInTheDocument()
    expect(chip('土曜の集合', '👍 2 件、自分も付けた')).toBeInTheDocument()
    expect(within(list('土曜の集合')).getAllByRole('button')).toHaveLength(2)
    expect(fetch.keys()).toContain('PUT /api/messages/1/reactions/%F0%9F%91%8D%EF%B8%8F')
  })

  it('「＋」から選ぶと、新しい絵文字を最後に足す', async () => {
    await open([message(1, '土曜の集合', { reactions: [reaction('👍', [hanako])] })], {
      'PUT /api/messages/1/reactions/%F0%9F%8E%89': () =>
        json(200, { reactions: [reaction('👍', [hanako]), reaction('🎉', [taro])] }),
    })
    const user = userEvent.setup()
    await user.click(chip('土曜の集合', 'リアクションを付ける'))
    await user.click(within(await screen.findByRole('dialog', { name: '絵文字の一覧' })).getByRole('button', { name: '🎉' }))
    const names = within(list('土曜の集合')).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['👍 1 件', '🎉 1 件、自分も付けた', 'リアクションを付ける'])
  })

  it('失敗したら表示を戻して M-49 を出す', async () => {
    await open([message(1, '土曜の集合', { reactions: [reaction('🎉', [jiro])] })], {
      'PUT /api/messages/1/reactions/%F0%9F%8E%89': () => json(500, { code: 'INTERNAL_ERROR', message: M[49] }),
    })
    await userEvent.setup().click(chip('土曜の集合', '🎉 1 件'))
    expect(await screen.findByText(M[49])).toBeInTheDocument()
    expect(chip('土曜の集合', '🎉 1 件')).toHaveAttribute('aria-pressed', 'false')
  })

  it('50 種類を超えるときは、表示を戻して M-42 を出す（RE-7、TC-10-6）', async () => {
    const m42 = 'このメッセージにはこれ以上の種類のリアクションを付けられません。'
    await open([message(1, '人気の投稿', { reactions: [reaction('👍', [hanako])] })], {
      'PUT /api/messages/1/reactions/%F0%9F%8E%89': () => json(409, { code: 'REACTION_LIMIT', message: m42 }),
    })
    const user = userEvent.setup()
    await user.click(chip('人気の投稿', 'リアクションを付ける'))
    await user.click(within(await screen.findByRole('dialog', { name: '絵文字の一覧' })).getByRole('button', { name: '🎉' }))
    expect(await screen.findByText(m42)).toBeInTheDocument()
    expect(within(list('人気の投稿')).queryByRole('button', { name: /🎉/ })).not.toBeInTheDocument()
  })
})

describe('付けた人（RE-4、TC-10-4）', () => {
  it('重ねると、付けた人の表示名を付けた順に出す', async () => {
    await open([message(1, '土曜の集合', { reactions: [reaction('👍', [hanako, jiro])] })])
    const target = chip('土曜の集合', '👍 2 件')
    const user = userEvent.setup()
    await user.hover(target)
    expect(screen.getByRole('tooltip')).toHaveTextContent('はなこ、じろう')
    expect(target).toHaveAccessibleDescription('はなこ、じろう')
    await user.unhover(target)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('タッチで押したときは、重ねたことにならず付けた人を出さない', async () => {
    await open([message(1, '土曜の集合', { reactions: [reaction('👍', [hanako])] })], {
      'PUT /api/messages/1/reactions/%F0%9F%91%8D': () => json(200, { reactions: [reaction('👍', [hanako, taro])] }),
    })
    await userEvent.setup().pointer({ keys: '[TouchA]', target: chip('土曜の集合', '👍 1 件') })
    expect(await screen.findByRole('button', { name: '👍 2 件、自分も付けた' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('21 人以上は「ほか N 人」', () => {
    const users = Array.from({ length: 20 }, (_, i) => ({ username: `u${i}`, displayName: `ゆーざー${i}` }))
    expect(reactorNames({ emoji: '👍', count: 23, reactedByMe: false, users }))
      .toBe(`${users.map((u) => u.displayName).join('、')}、ほか 3 人`)
  })

  it('長押しで出し、そのときは付ける・外すにしない', async () => {
    vi.useFakeTimers()
    try {
      await act(async () => {
        mockFetch({ ...opened, 'GET /api/conversations/10/messages': page([
          message(1, '土曜の集合', { reactions: [reaction('👍', [hanako])] }),
        ]) })
        renderAt('/w/3/c/10')
      })
      await act(() => vi.runOnlyPendingTimersAsync())
      const target = chip('土曜の集合', '👍 1 件')
      fireEvent.touchStart(target)
      act(() => vi.advanceTimersByTime(500))
      expect(screen.getByRole('tooltip')).toHaveTextContent('はなこ')
      fireEvent.touchEnd(target)
      fireEvent.click(target)
      expect(chip('土曜の集合', '👍 1 件')).toHaveAttribute('aria-pressed', 'false')
      // 指を離して少しすると消える
      act(() => vi.advanceTimersByTime(2000))
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('付けられないとき（RE-7、TC-10-7）', () => {
  it('参加していない公開チャンネルでは、リアクションのボタンと「＋」を出さず、押しても付けない', async () => {
    const { fetch } = await open([message(1, '土曜の集合', { reactions: [reaction('👍', [hanako])] })], {
      'GET /api/conversations/10': () => json(200, detail(10, 'general', { general: true, joined: false, canPost: false })),
    })
    expect(within(article('土曜の集合')).queryByRole('button', { name: 'リアクション' })).not.toBeInTheDocument()
    expect(within(list('土曜の集合')).queryByRole('button', { name: 'リアクションを付ける' })).not.toBeInTheDocument()
    const target = chip('土曜の集合', '👍 1 件')
    expect(target).toHaveAttribute('aria-disabled', 'true')
    await userEvent.setup().click(target)
    expect(fetch.keys().some((k) => k.includes('/reactions/'))).toBe(false)
    // 付けた人は見られる
    await userEvent.setup().hover(target)
    expect(screen.getByRole('tooltip')).toHaveTextContent('はなこ')
  })

  it('「削除されました」のメッセージには、リアクションのボタンを出さない', async () => {
    await open([message(1, '前のメッセージ'), message(2, '', { deleted: true, replyCount: 1 })])
    const deleted = screen.getByText(M[33]).closest('article')!
    expect(within(deleted).queryByRole('button', { name: 'リアクション' })).not.toBeInTheDocument()
  })
})

describe('リアルタイムの反映（RE-6、TC-10-3）', () => {
  it('reaction.updated で置き換え、付けた人に自分がいれば押した状態にする', async () => {
    const { client } = await open([message(1, '土曜の集合')])
    act(() => client.deliver(conversationTopic(10), event('reaction.updated', {
      messageId: 1, reactions: [{ emoji: '👍', count: 2, reactedByMe: false, users: [hanako, taro] }],
    })))
    expect(chip('土曜の集合', '👍 2 件、自分も付けた')).toHaveAttribute('aria-pressed', 'true')

    act(() => client.deliver(conversationTopic(10), event('reaction.updated', { messageId: 1, reactions: [] })))
    expect(within(article('土曜の集合')).queryByRole('list', { name: 'リアクション' })).not.toBeInTheDocument()
  })
})

describe('reactionsForViewer（FN-10 5 章の 4）', () => {
  const viewer = { me, owner: false }
  const twenty = Array.from({ length: 20 }, (_, i) => ({ username: `u${i}`, displayName: `ゆーざー${i}` }))

  it('付けた人の 20 人に自分がいなくても、21 人目より後に付けていれば押した状態を残す', () => {
    const previous = [{ emoji: '👍', count: 21, reactedByMe: true, users: twenty }]
    const incoming = [{ emoji: '👍', count: 22, reactedByMe: false, users: twenty }]
    expect(reactionsForViewer(incoming, viewer, previous)[0].reactedByMe).toBe(true)
    expect(reactionsForViewer(incoming, viewer, [])[0].reactedByMe).toBe(false)
  })
})

describe('toggled', () => {
  it('付けた人は 20 人までにし、外したら自分を除く', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ username: `u${i}`, displayName: `ゆーざー${i}` }))
    const added = toggled([{ emoji: '👍', count: 20, reactedByMe: false, users: twenty }], '👍️', me, true)
    expect(added[0]).toMatchObject({ emoji: '👍', count: 21, reactedByMe: true })
    expect(added[0].users).toHaveLength(20)
    const removed = toggled([reaction('👍', [hanako, taro])], '👍', me, false)
    expect(removed[0]).toEqual({ emoji: '👍', count: 1, reactedByMe: false, users: [hanako] })
  })
})
