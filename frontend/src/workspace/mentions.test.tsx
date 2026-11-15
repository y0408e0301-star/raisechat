import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageView } from '../api'
import { clearDrafts } from '../drafts'
import MessageBody from '../markdown/MessageBody'
import { json, mockFetch, sentJson, type Handler } from '../test/fetchMock'
import { me, renderComponent } from '../test/render'
import { opened, renderAt } from '../test/workspace'
import { insertMention, mentionQuery } from './mentionSuggest'

// G-5 のメンション（FN-11 MN-1〜MN-3・MN-7、画面設計書 2.9・2.10・2.16）

// 絵文字の一覧（emoji-picker-element）は jsdom では動かないので、選ぶボタンだけの偽物にする
vi.mock('../components/EmojiPicker', () => ({
  default: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <dialog open aria-label="絵文字の一覧">
      <button type="button" onClick={() => onSelect('🎉')}>🎉</button>
    </dialog>
  ),
}))

const hanako = { username: 'hanako', displayName: 'はなこ', avatarUrl: null, statusEmoji: null, statusText: null }
const jiro = { username: 'jiro', displayName: 'じろう', avatarUrl: null, statusEmoji: null, statusText: null }

const message = (id: number, body: string, extra: Partial<MessageView> = {}): MessageView => ({
  id, conversationId: 10, parentId: null, author: hanako, body, mentions: [], attachments: [], reactions: [],
  replyCount: 0, lastReplyAt: null, replyUsers: [], createdAt: '2026-11-11T01:00:00Z', editedAt: null, deleted: false,
  mine: false, canDelete: false, ...extra,
})

const page = (items: object[]) => () => json(200, { items, hasMoreBefore: false, hasMoreAfter: false })

async function open(routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({ ...opened, ...routes })
  renderAt('/w/3/c/10')
  await screen.findByRole('textbox', { name: 'メッセージ' })
  return fetch
}

afterEach(() => {
  clearDrafts()
  vi.useRealTimers()
})

describe('メッセージの中のメンション（MN-3、TC-11-4〜6）', () => {
  const mentions = [{ username: 'hanako', displayName: 'はなこ' }, { username: 'taro_y', displayName: 'たろう' }]

  it('記録したメンションだけを目立たせ、自分あては背景も変える。大文字・小文字は区別しない', () => {
    renderComponent(<MessageBody body="@HANAKO と @taro_y、@nobody と a@hanako" mentions={mentions} me={me.username} />)
    expect(screen.getByText('@HANAKO')).toHaveClass(/mention/)
    expect(screen.getByText('@HANAKO')).not.toHaveClass(/toMe/)
    expect(screen.getByText('@taro_y')).toHaveClass(/toMe/)
    // 記録しなかったもの・メールアドレスのようなものは普通の文字
    expect(screen.getByText(/@nobody/)).not.toHaveClass(/mention/)
    expect(screen.getByText(/@nobody/).textContent).toContain('a@hanako')
  })

  it('コード・コードブロック・リンクの中は目立たせない', () => {
    const { container } = renderComponent(
      <MessageBody body={'`@hanako` と https://example.com/@hanako\n```\n@hanako\n```\n~~~\n@hanako\n~~~\n\n    @hanako'}
        mentions={mentions} />,
    )
    expect(container.querySelectorAll('[class*="mention"]')).toHaveLength(0)
  })

  it('自分へのメンションを含むメッセージは、左の線と背景で目立たせ、「@ユーザー ID」を押すと G-16 を出す', async () => {
    await open({
      'GET /api/conversations/10/messages': page([
        message(1, '@taro_y 明日どう？', { mentions: [{ username: 'taro_y', displayName: 'たろう' }] }),
        message(2, '@jiro はどう？', { mentions: [{ username: 'jiro', displayName: 'じろう' }] }),
      ]),
      'GET /api/workspaces/3/members/jiro': () => json(200, { ...jiro, role: 'MEMBER', statusExpiresAt: null }),
    })
    const toMe = (await screen.findByText('@taro_y')).closest('article')!
    expect(toMe.className).toMatch(/toMe/)
    const other = screen.getByText('@jiro').closest('article')!
    expect(other.className).not.toMatch(/toMe/)

    await userEvent.setup().click(within(other).getByRole('button', { name: '@jiro' }))
    expect(await screen.findByRole('dialog', { name: /じろう/ })).toBeInTheDocument()
  })
})

describe('mentionQuery・insertMention', () => {
  it('入力の位置の直前の「@〜」を見つける。メールアドレスと空白の後では出さない', () => {
    expect(mentionQuery('こんにちは @はな', 9)).toEqual({ start: 6, text: 'はな' })
    expect(mentionQuery('@', 1)).toEqual({ start: 0, text: '' })
    expect(mentionQuery('a@hana', 6)).toBeNull()
    expect(mentionQuery('@hana ', 6)).toBeNull()
    expect(mentionQuery(`@${'a'.repeat(31)}`, 32)).toBeNull()
  })

  it('「@〜」を「@ユーザー ID 」に置き換える', () => {
    expect(insertMention('よろしく @ha', 8, 5, 'hanako')).toEqual({ value: 'よろしく @hanako ', caret: 13 })
    expect(insertMention('よろしく @ha です', 8, 5, 'hanako')).toEqual({ value: 'よろしく @hanako です', caret: 13 })
  })
})

describe('入力欄の候補（MN-1、TC-11-1）', () => {
  const candidates = [{ user: jiro, member: true }, { user: hanako, member: false }]

  it('「@」の後の文字で候補を出し、上下の矢印と Enter で入れる。会話のメンバーでない人には「チャンネルにいません」', async () => {
    const fetch = await open({
      'GET /api/conversations/10/mention-candidates?q=': () => json(200, candidates),
      'GET /api/conversations/10/mention-candidates?q=%E3%81%AF': () => json(200, [candidates[1]]),
      'POST /api/conversations/10/messages': () => json(201, message(5, '@hanako よろしく')),
    })
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: 'メッセージ' })

    await user.type(input, '@')
    const list = await screen.findByRole('listbox', { name: 'メンションの候補' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'じじろう@jiro', 'ははなこ@hanakoチャンネルにいません',
    ])
    expect(within(list).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(within(list).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    // 打った文字で絞り込んだ候補に替わる
    await user.type(input, 'は')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    await user.keyboard('{Enter}')

    // Enter は送らずに「@ユーザー ID 」を入れる
    expect(input).toHaveValue('@hanako ')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(fetch.keys()).not.toContain('POST /api/conversations/10/messages')

    await user.type(input, 'よろしく{Enter}')
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/conversations/10/messages'))).toMatchObject({ body: '@hanako よろしく' })
  })

  it('Tab とクリックでも入れられ、Esc で閉じる', async () => {
    await open({ 'GET /api/conversations/10/mention-candidates?q=': () => json(200, candidates) })
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: 'メッセージ' })

    await user.type(input, '@')
    await screen.findByRole('listbox')
    await user.keyboard('{Tab}')
    expect(input).toHaveValue('@jiro ')

    await user.type(input, '@')
    await user.click(await screen.findByRole('option', { name: /はなこ/ }))
    expect(input).toHaveValue('@jiro @hanako ')

    await user.type(input, '@')
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveValue('@jiro @hanako @')
  })

  it('打つたびには呼ばず、止まってから 0.2 秒後に 1 回だけ呼ぶ', async () => {
    const fetch = await open({
      'GET /api/conversations/10/mention-candidates?q=hana': () => json(200, [candidates[1]]),
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.type(screen.getByRole('textbox', { name: 'メッセージ' }), '@hana')
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(await screen.findByRole('option', { name: /はなこ/ })).toBeInTheDocument()
    expect(fetch.keys().filter((k) => k.includes('mention-candidates'))).toEqual([
      'GET /api/conversations/10/mention-candidates?q=hana',
    ])
  })

  it('文字を消したときは、前の候補を出したままにしない', async () => {
    await open({
      'GET /api/conversations/10/mention-candidates?q=ha': () => json(200, [candidates[1]]),
      // 消した後の候補はまだ届かない
      'GET /api/conversations/10/mention-candidates?q=': () => new Promise<Response>(() => {}),
    })
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'メッセージ' }), '@ha')
    await screen.findByRole('option', { name: /はなこ/ })
    await user.keyboard('{Backspace}{Backspace}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('候補を読めなかったときは出さない', async () => {
    await open({ 'GET /api/conversations/10/mention-candidates?q=': () => json(500, { code: 'INTERNAL_ERROR', message: 'x' }) })
    const input = screen.getByRole('textbox', { name: 'メッセージ' })
    await userEvent.setup().type(input, '@')
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('メッセージの編集でも候補を出す', async () => {
    await open({
      'GET /api/conversations/10/messages': page([message(1, '直す', { author: me, mine: true, canDelete: true })]),
      'GET /api/conversations/10/mention-candidates?q=': () => json(200, candidates),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '編集' }))
    const editor = screen.getByRole('textbox', { name: 'メッセージを編集' })
    await user.type(editor, ' @')
    await screen.findByRole('listbox')
    await user.keyboard('{Enter}')
    expect(editor).toHaveValue('直す @jiro ')
  })
})

describe('入力欄の 😀（画面設計書 2.14）', () => {
  it('絵文字の一覧で選んだ絵文字を、カーソルの位置に入れる', async () => {
    await open()
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: 'メッセージ' })
    await user.type(input, 'おめでとう')
    await user.click(screen.getByRole('button', { name: '絵文字' }))
    await user.click(within(await screen.findByRole('dialog', { name: '絵文字の一覧' })).getByRole('button', { name: '🎉' }))
    expect(input).toHaveValue('おめでとう🎉')
  })
})
