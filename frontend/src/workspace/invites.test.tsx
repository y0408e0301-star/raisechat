import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { M } from '../messages'
import { json, mockFetch, type Handler } from '../test/fetchMock'
import { opened, renderAt, workspace } from '../test/workspace'

// 招待リンクの管理（FN-04 I-1〜I-3・I-9）の画面：サイドバーのメニュー・G-11・G-18

const sidebar = () => screen.getByRole('navigation', { name: '会話' })
const location = () => screen.getByRole('status', { name: '今の URL' })
// G-11 の行（サイドバーの行は数えない）
const rows = () => within(screen.getByRole('main')).getAllByRole('listitem')
const findRows = async () => {
  await screen.findByRole('heading', { level: 1, name: '招待リンク' })
  return vi.waitFor(rows)
}

function open(path: string, routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({ ...opened, ...routes })
  renderAt(path)
  return fetch
}

const TOKEN = 'Xa9'.padEnd(43, 'b')

const invite = (id: number, extra: object = {}) => ({
  id, url: `http://localhost:5173/invite/${TOKEN}`, createdAt: '2026-11-10T01:15:00Z',
  expiresAt: '2026-11-17T01:15:00Z', revokedAt: null, status: 'ACTIVE', ...extra,
})

const page = (items: object[], nextCursor: string | null = null) => () => json(200, { items, nextCursor })

describe('サイドバーのメニュー（I-1・I-9、TC-04-9）', () => {
  it('オーナーには「招待リンクの管理」を出し、押すと G-11 を開く', async () => {
    open('/w/3/c/10', { 'GET /api/workspaces/3/invites': page([]) })
    const user = userEvent.setup()
    await screen.findByRole('navigation', { name: '会話' })
    await user.click(within(sidebar()).getByRole('button', { name: '仲間うちのメニュー' }))
    await user.click(within(sidebar()).getByRole('link', { name: '招待リンクの管理' }))

    expect(location()).toHaveTextContent('/w/3/invites')
    expect(await screen.findByRole('heading', { level: 1, name: '招待リンク' })).toBeInTheDocument()
    expect(screen.getByText('招待リンクはありません。')).toBeInTheDocument()
  })

  it('オーナーでない人には出さず、G-11 の URL を開くと G-5 に移す', async () => {
    open('/w/3/invites', { 'GET /api/workspaces/3': () => json(200, workspace({ role: 'MEMBER' })) })
    const user = userEvent.setup()

    await vi.waitFor(() => expect(location()).toHaveTextContent('/w/3/c/10'))
    await user.click(within(sidebar()).getByRole('button', { name: '仲間うちのメニュー' }))
    expect(within(sidebar()).queryByRole('link', { name: '招待リンクの管理' })).not.toBeInTheDocument()
    expect(within(sidebar()).getByRole('link', { name: 'ワークスペースの一覧' })).toBeInTheDocument()
  })
})

describe('G-11 招待リンクの管理画面（I-1〜I-3、TC-04-1）', () => {
  it('URL・状態・期限・作った日時を出し、有効なものにだけ「コピー」「取り消す」を出す', async () => {
    open('/w/3/invites', {
      'GET /api/workspaces/3/invites': page([
        invite(3),
        invite(2, { status: 'REVOKED', revokedAt: '2026-11-11T00:00:00Z' }),
        invite(1, { status: 'EXPIRED' }),
      ]),
    })

    const found = await findRows()
    expect(found).toHaveLength(3)
    expect(found[0]).toHaveTextContent('有効')
    expect(found[0]).toHaveTextContent('11月17日 10:15 まで')
    expect(found[0]).toHaveTextContent('11月10日 10:15 に作成')
    // 長い URL は真ん中を「…」で省き、重ねると全部を出す
    expect(within(found[0]).getByTitle(`http://localhost:5173/invite/${TOKEN}`)).toHaveTextContent('…')
    expect(within(found[0]).getByRole('button', { name: 'コピー' })).toBeInTheDocument()
    expect(found[1]).toHaveTextContent('取り消し済み')
    expect(found[1]).not.toHaveTextContent('まで')
    expect(within(found[1]).queryByRole('button')).not.toBeInTheDocument()
    expect(found[2]).toHaveTextContent('期限切れ')
    expect(within(found[2]).queryByRole('button')).not.toBeInTheDocument()
  })

  it('「招待リンクを作る」で作り、一覧の先頭に出す', async () => {
    const fetch = open('/w/3/invites', {
      'GET /api/workspaces/3/invites': page([invite(1)]),
      'POST /api/workspaces/3/invites': () => json(201, invite(2, { createdAt: '2026-11-12T01:15:00Z' })),
    })
    const user = userEvent.setup()
    await findRows()

    await user.click(screen.getByRole('button', { name: '招待リンクを作る' }))

    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    expect(rows()[0]).toHaveTextContent('11月12日 10:15 に作成')
    expect(fetch.keys()).toContain('POST /api/workspaces/3/invites')
  })

  it('「コピー」で URL をクリップボードに入れて M-20 を出す', async () => {
    open('/w/3/invites', { 'GET /api/workspaces/3/invites': page([invite(1)]) })
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')

    await user.click(await screen.findByRole('button', { name: 'コピー' }))

    expect(writeText).toHaveBeenCalledWith(`http://localhost:5173/invite/${TOKEN}`)
    expect(await screen.findByText(M[20])).toBeInTheDocument()
  })

  it('「取り消す」で G-18 に M-17 を出し、取り消すと「取り消し済み」にする。キャンセルでは何もしない', async () => {
    const fetch = open('/w/3/invites', {
      'GET /api/workspaces/3/invites': page([invite(1)]),
      'DELETE /api/workspaces/3/invites/1': () => json(204),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: '取り消す' }))
    const dialog = screen.getByRole('dialog', { name: '招待リンクの取り消し' })
    expect(dialog).toHaveTextContent(M[17])
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetch.keys()).not.toContain('DELETE /api/workspaces/3/invites/1')

    await user.click(screen.getByRole('button', { name: '取り消す' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取り消す' }))

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(rows()[0]).toHaveTextContent('取り消し済み')
    expect(within(rows()[0]).queryByRole('button')).not.toBeInTheDocument()
  })

  it('取り消そうとしたリンクがなければ M-49 を出して一覧を読み直す', async () => {
    const fetch = open('/w/3/invites', {
      'GET /api/workspaces/3/invites': [page([invite(1)]), page([])],
      'DELETE /api/workspaces/3/invites/1': () => json(404, { code: 'INVITE_NOT_FOUND', message: M[49] }),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: '取り消す' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取り消す' }))

    expect(await screen.findByText(M[49])).toBeInTheDocument()
    expect(await screen.findByText('招待リンクはありません。')).toBeInTheDocument()
    expect(fetch.keys().filter((k) => k === 'GET /api/workspaces/3/invites')).toHaveLength(2)
  })

  it('読み込みに失敗したら M-48 と「再読み込み」を出す', async () => {
    open('/w/3/invites', {
      'GET /api/workspaces/3/invites': [() => json(500, { code: 'INTERNAL_ERROR', message: M[49] }), page([invite(1)])],
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: '再読み込み' }))

    expect(await screen.findByRole('button', { name: 'コピー' })).toBeInTheDocument()
  })
})
