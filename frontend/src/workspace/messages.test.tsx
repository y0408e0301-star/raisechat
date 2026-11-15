import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearDrafts } from '../drafts'
import { M } from '../messages'
import { json, mockFetch, sentJson, type Handler } from '../test/fetchMock'
import { me } from '../test/render'
import { opened, renderAt } from '../test/workspace'

// G-5 の会話のメッセージ（FN-07 MS-1〜MS-4・MS-6〜MS-13・MS-15）

const hanako = { username: 'hanako', displayName: 'はなこ', avatarUrl: null, statusEmoji: null, statusText: null }

const message = (id: number, body: string, extra: object = {}) => ({
  id, conversationId: 10, parentId: null, author: me, body, mentions: [], attachments: [], reactions: [], replyCount: 0, lastReplyAt: null, replyUsers: [],
  createdAt: '2026-11-11T01:00:00Z', editedAt: null, deleted: false, mine: true, canDelete: true, ...extra,
})

const page = (items: object[], hasMoreBefore = false) => () => json(200, { items, hasMoreBefore, hasMoreAfter: false })

function openGeneral(routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({ ...opened, ...routes })
  renderAt('/w/3/c/10')
  return fetch
}

const input = () => screen.getByRole('textbox', { name: 'メッセージ' })

const articles = () => screen.getAllByRole('article')

afterEach(() => clearDrafts())

describe('一覧（MS-1・MS-2・MS-12）', () => {
  it('古い順に並べ、最後のメッセージまで読んだことを記録する', async () => {
    const fetch = openGeneral({
      'GET /api/conversations/10/messages': page([message(1, '1 通目'), message(2, '2 通目')]),
    })
    expect(await screen.findByText('1 通目')).toBeInTheDocument()
    expect(articles().map((a) => a.textContent)).toEqual([expect.stringContaining('1 通目'), expect.stringContaining('2 通目')])
    await vi.waitFor(() => expect(fetch.keys()).toContain('POST /api/conversations/10/read'))
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/conversations/10/read'))).toEqual({ lastMessageId: 2 })
  })

  // TC-07-7
  it('前がなければ会話の始まりを出し、前があれば上まで戻ったときに読み込む', async () => {
    const fetch = openGeneral({
      'GET /api/conversations/10/messages': page([message(51, '51 通目')], true),
      'GET /api/conversations/10/messages?before=51': page([message(1, '1 通目')]),
    })
    await screen.findByText('51 通目')
    expect(screen.queryByText('このチャンネルはここから始まります。')).not.toBeInTheDocument()
    const list = screen.getByText('51 通目').closest('article')!.parentElement!
    fireEvent.scroll(list, { target: { scrollTop: 0 } })
    expect(await screen.findByText('1 通目')).toBeInTheDocument()
    expect(screen.getByText('このチャンネルはここから始まります。')).toBeInTheDocument()
    expect(fetch.keys()).toContain('GET /api/conversations/10/messages?before=51')
    expect(articles()[0]).toHaveTextContent('1 通目')
  })

  it('同じ人が 5 分以内に続けて送ったものは名前を省き、日付が変わるところに区切りを出す', async () => {
    openGeneral({
      'GET /api/conversations/10/messages': page([
        message(1, 'a', { createdAt: '2026-11-10T01:00:00Z' }),
        // 5 分以内
        message(2, 'b', { createdAt: '2026-11-10T01:05:00Z' }),
        // 5 分より後
        message(3, 'c', { createdAt: '2026-11-10T01:10:01Z' }),
        // ほかの人
        message(4, 'd', { createdAt: '2026-11-10T01:10:30Z', author: hanako, mine: false, canDelete: false }),
        // 日本時間で次の日（11月11日 0:00）
        message(5, 'e', { createdAt: '2026-11-10T15:00:00Z', author: hanako, mine: false, canDelete: false }),
      ]),
    })
    await screen.findByText('e')
    const named = articles().map((a) => within(a).queryByText(/たろう|はなこ/) !== null)
    expect(named).toEqual([true, false, true, true, true])
    expect(screen.getByText('11月10日（火）')).toBeInTheDocument()
    expect(screen.getByText('11月11日（水）')).toBeInTheDocument()
  })

  it('編集したものに「（編集済み）」、削除された親に M-33 を出す', async () => {
    openGeneral({
      'GET /api/conversations/10/messages': page([
        message(1, '直した', { editedAt: '2026-11-11T01:01:00Z' }),
        message(2, '', { deleted: true, replyCount: 2, canDelete: false }),
      ]),
    })
    expect(await screen.findByText('（編集済み）')).toBeInTheDocument()
    expect(screen.getByText(M[33])).toBeInTheDocument()
  })

  it('続けて送ったメッセージ（時刻を隠すもの）でも「（編集済み）」を出す', async () => {
    openGeneral({
      'GET /api/conversations/10/messages': page([
        message(1, '1 通目'),
        message(2, '2 通目', { editedAt: '2026-11-11T01:01:00Z' }),
      ]),
    })
    await screen.findByText('2 通目')
    expect(within(articles()[1]).getByText('（編集済み）')).toBeInTheDocument()
  })
})

describe('送信（MS-3・MS-4・MS-8・MS-13）', () => {
  // TC-07-2
  it('Enter で送り、送っている間は「送信中…」。Shift＋Enter は改行', async () => {
    let resolve: ((r: Response) => void) | undefined
    const fetch = openGeneral({
      'POST /api/conversations/10/messages': () => new Promise<Response>((r) => {
        resolve = r
      }),
      'POST /api/conversations/10/read': () => json(204),
    })
    await userEvent.type(await screen.findByRole('textbox', { name: 'メッセージ' }), '1 行目{Shift>}{Enter}{/Shift}2 行目')
    expect(input()).toHaveValue('1 行目\n2 行目')
    await userEvent.keyboard('{Enter}')
    expect(input()).toHaveValue('')
    expect(screen.getByText('送信中…')).toBeInTheDocument()
    const sent = sentJson(fetch, fetch.keys().indexOf('POST /api/conversations/10/messages')) as { body: string, clientId: string }
    expect(sent.body).toBe('1 行目\n2 行目')
    expect(sent.clientId).toMatch(/^[0-9a-f-]{36}$/)

    resolve?.(json(201, message(7, '1 行目\n2 行目')))
    await vi.waitFor(() => expect(screen.queryByText('送信中…')).not.toBeInTheDocument())
    expect(articles()).toHaveLength(1)
  })

  // TC-07-2
  it('日本語の入力の変換を確定する Enter では送らない', async () => {
    const fetch = openGeneral()
    await userEvent.type(await screen.findByRole('textbox', { name: 'メッセージ' }), 'にほんご')
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 })
    expect(fetch.keys()).not.toContain('POST /api/conversations/10/messages')
    expect(input()).toHaveValue('にほんご')
  })

  it('空白だけのときは送れない', async () => {
    openGeneral()
    await userEvent.type(await screen.findByRole('textbox', { name: 'メッセージ' }), '   ')
    expect(screen.getByRole('button', { name: '送信 ➤' })).toBeDisabled()
  })

  // TC-07-1・MS-4
  it('3,800 文字を超えたら残りの文字数を出し、4,000 文字を超えたら M-35 を出して送れない', async () => {
    const fetch = openGeneral()
    await screen.findByRole('textbox', { name: 'メッセージ' })
    fireEvent.change(input(), { target: { value: 'あ'.repeat(3800) } })
    expect(screen.queryByText(/^残り/)).not.toBeInTheDocument()
    fireEvent.change(input(), { target: { value: 'あ'.repeat(3801) } })
    expect(screen.getByText('残り 199')).toBeInTheDocument()
    fireEvent.change(input(), { target: { value: 'あ'.repeat(4001) } })
    expect(screen.getByText(`-1 ${M[35]}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '送信 ➤' })).toBeDisabled()
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(fetch.keys()).not.toContain('POST /api/conversations/10/messages')
  })

  it('MS-8：選んだ文字の前後に記号を入れ、選んでいなければ記号の間にカーソルを置く', async () => {
    openGeneral()
    await userEvent.type(await screen.findByRole('textbox', { name: 'メッセージ' }), '土曜の集合')
    const el = input() as HTMLTextAreaElement
    el.setSelectionRange(0, 2)
    await userEvent.click(screen.getByRole('button', { name: '太字' }))
    expect(el).toHaveValue('**土曜**の集合')
    el.setSelectionRange(el.value.length, el.value.length)
    await userEvent.click(screen.getByRole('button', { name: 'コード' }))
    expect(el).toHaveValue('**土曜**の集合``')
    expect(el.selectionStart).toBe(el.value.length - 1)
  })

  // TC-07-12
  it('送れなかったら M-34 を出し、「もう一度送る」は同じ clientId で送る', async () => {
    const fetch = openGeneral({
      'POST /api/conversations/10/messages': [
        () => json(500, { code: 'INTERNAL_ERROR', message: M[49] }),
        () => json(201, message(8, '送りたい')),
      ],
      'POST /api/conversations/10/read': () => json(204),
    })
    await userEvent.type(await screen.findByRole('textbox', { name: 'メッセージ' }), '送りたい{Enter}')
    expect(await screen.findByText(M[34])).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'もう一度送る' }))
    await vi.waitFor(() => expect(screen.queryByText(M[34])).not.toBeInTheDocument())
    const posts = fetch.calls.filter((c) => c.key === 'POST /api/conversations/10/messages')
      .map((c) => JSON.parse(String(c.init?.body)) as { clientId: string })
    expect(posts).toHaveLength(2)
    expect(posts[0].clientId).toBe(posts[1].clientId)
    expect(articles()).toHaveLength(1)
  })

  it('MS-13：「取り消す」で一覧から消し、本文を入力欄に戻す', async () => {
    openGeneral({ 'POST /api/conversations/10/messages': () => json(500, { code: 'INTERNAL_ERROR', message: M[49] }) })
    await userEvent.type(await screen.findByRole('textbox', { name: 'メッセージ' }), '送りたい{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: '取り消す' }))
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(input()).toHaveValue('送りたい')
  })
})

describe('編集と削除（MS-9〜MS-11）', () => {
  // TC-07-9
  it('自分のメッセージは編集でき、Enter で保存すると「（編集済み）」になる。Esc でやめる', async () => {
    const fetch = openGeneral({
      'GET /api/conversations/10/messages': page([message(1, '前')]),
      'PATCH /api/messages/1': () => json(200, message(1, '後', { editedAt: '2026-11-11T01:02:00Z' })),
      'POST /api/conversations/10/read': () => json(204),
    })
    await userEvent.click(await screen.findByRole('button', { name: '編集' }))
    const editor = screen.getByRole('textbox', { name: 'メッセージを編集' })
    expect(editor).toHaveValue('前')
    expect(editor).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'メッセージを編集' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '編集' }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'メッセージを編集' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'メッセージを編集' }), ' 後 {Enter}')
    expect(await screen.findByText('（編集済み）')).toBeInTheDocument()
    expect(screen.getByText('後')).toBeInTheDocument()
    expect(sentJson(fetch, fetch.keys().indexOf('PATCH /api/messages/1'))).toEqual({ body: '後', keepAttachmentIds: [] })
  })

  it('ほかの人のメッセージには「編集」を出さず、消せないものには「削除」も出さない', async () => {
    openGeneral({
      'GET /api/conversations/10/messages': page([message(1, 'はなこの', { author: hanako, mine: false, canDelete: false })]),
    })
    await screen.findByText('はなこの')
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  // TC-07-10
  it('自分のメッセージは M-31 で確かめて消す。「キャンセル」にカーソルを置く', async () => {
    openGeneral({
      'GET /api/conversations/10/messages': page([message(1, '消す')]),
      'DELETE /api/messages/1': () => json(204),
    })
    await userEvent.click(await screen.findByRole('button', { name: '削除' }))
    const dialog = screen.getByRole('dialog', { name: 'メッセージの削除' })
    expect(dialog).toHaveTextContent(M[31])
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: '削除' }))
    await vi.waitFor(() => expect(screen.queryByText('消す')).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // TC-07-10・TC-07-11
  it('オーナーはほかの人のメッセージを M-32 で消せる。返信のある親は M-33 になる', async () => {
    openGeneral({
      'GET /api/conversations/10/messages': page([message(1, '親', { author: hanako, mine: false, replyCount: 1 })]),
      'DELETE /api/messages/1': () => json(200, message(1, '', { author: hanako, mine: false, deleted: true, replyCount: 1, canDelete: false })),
    })
    await userEvent.click(await screen.findByRole('button', { name: '削除' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('はなこさんのメッセージを削除しますか？元に戻せません。')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '削除' }))
    expect(await screen.findByText(M[33])).toBeInTheDocument()
  })

  it('消すのに失敗したら閉じて M-49 を出す', async () => {
    openGeneral({
      'GET /api/conversations/10/messages': page([message(1, '消す')]),
      'DELETE /api/messages/1': () => json(500, { code: 'INTERNAL_ERROR', message: M[49] }),
    })
    await userEvent.click(await screen.findByRole('button', { name: '削除' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '削除' }))
    expect(await screen.findByText(M[49])).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('消す')).toBeInTheDocument()
  })
})

// TC-07-14
describe('入力の文の保持（MS-15）', () => {
  it('ほかの会話に移って戻ると、入力した文が残っている', async () => {
    openGeneral({
      'GET /api/conversations/11': () => json(200, { id: 11, workspaceId: 3, type: 'CHANNEL', name: '運営', visibility: 'PRIVATE',
        general: false, dmPartner: null, joined: true, hasUnread: false, unreadCount: 0, mentionCount: 0, canPost: true,
        description: null, memberCount: 1, createdBy: me, createdAt: '2026-11-11T03:00:00Z' }),
      'POST /api/conversations/11/read': () => json(204),
    })
    await userEvent.type(await screen.findByRole('textbox', { name: 'メッセージ' }), '書きかけ')
    await userEvent.click(screen.getByRole('link', { name: '運営' }))
    await screen.findByRole('heading', { name: '運営', level: 1 })
    expect(input()).toHaveValue('')
    await userEvent.click(screen.getByRole('link', { name: 'general' }))
    await screen.findByRole('heading', { name: 'general', level: 1 })
    expect(input()).toHaveValue('書きかけ')
  })
})
