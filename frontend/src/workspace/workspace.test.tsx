import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { M } from '../messages'
import { json, mockFetch, sentJson } from '../test/fetchMock'
import { detail, opened, renderAt, workspace } from '../test/workspace'

// G-5 チャット画面の枠（FN-03 W-4・W-8・W-9、画面設計書 7 章）

const url = () => screen.getByRole('status', { name: '今の URL' })

describe('ワークスペースを開く（W-4）', () => {
  // TC-03-5
  it('初めて開くときは general を開き、開いたことを記録する', async () => {
    const fetch = mockFetch(opened)
    renderAt('/w/3')
    expect(await screen.findByRole('heading', { name: 'general', level: 1 })).toBeInTheDocument()
    expect(url()).toHaveTextContent('/w/3/c/10')
    await vi.waitFor(() => expect(fetch.keys()).toContain('POST /api/conversations/10/read'))
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/conversations/10/read'))).toEqual({ lastMessageId: 0 })
  })

  // TC-03-5
  it('最後に開いた会話があればそれを開く', async () => {
    mockFetch({
      ...opened,
      'GET /api/workspaces/3': () => json(200, workspace({ lastOpenedConversationId: 11 })),
      'GET /api/conversations/11': () => json(200, detail(11, '運営', { visibility: 'PRIVATE', description: '運営の相談' })),
      'POST /api/conversations/11/read': () => json(204),
    })
    renderAt('/w/3')
    expect(await screen.findByRole('heading', { name: '運営', level: 1 })).toBeInTheDocument()
    expect(screen.getAllByText('運営の相談')).toHaveLength(2)
    expect(screen.getByLabelText('メンバー 2 人')).toHaveTextContent('👥 2')
    expect(url()).toHaveTextContent('/w/3/c/11')
  })

  // TC-03-6
  it('M-13：入っていない・存在しないワークスペースは G-3 に移す', async () => {
    mockFetch({
      'GET /api/workspaces/4': () => json(404, { code: 'WORKSPACE_NOT_FOUND', message: M[13] }),
      'GET /api/workspaces/4/conversations': () => json(404, { code: 'WORKSPACE_NOT_FOUND', message: M[13] }),
    })
    renderAt('/w/4/c/1')
    expect(await screen.findByText('G-3')).toBeInTheDocument()
    expect(screen.getByText(M[13])).toBeInTheDocument()
  })

  it('数字でないワークスペースの URL も G-3 に移す', async () => {
    mockFetch({})
    renderAt('/w/abc')
    expect(await screen.findByText('G-3')).toBeInTheDocument()
    expect(screen.getByText(M[13])).toBeInTheDocument()
  })

  it('M-48：読み込みに失敗したら「再読み込み」で読み込み直す', async () => {
    mockFetch({
      ...opened,
      'GET /api/workspaces/3': [() => json(500, { code: 'INTERNAL_ERROR', message: M[49] }), () => json(200, workspace())],
    })
    renderAt('/w/3/c/10')
    expect(await screen.findByText(M[48])).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '再読み込み' }))
    expect(await screen.findByRole('heading', { name: 'general', level: 1 })).toBeInTheDocument()
  })
})

describe('会話（画面設計書 7.1）', () => {
  it('M-27：見られない会話は general を開く', async () => {
    mockFetch({
      ...opened,
      'GET /api/conversations/99': () => json(404, { code: 'CONVERSATION_NOT_FOUND', message: M[27] }),
    })
    renderAt('/w/3/c/99')
    expect(await screen.findByRole('heading', { name: 'general', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(M[27])).toBeInTheDocument()
    expect(url()).toHaveTextContent('/w/3/c/10')
  })

  it('ほかのワークスペースの会話の ID は、見られない会話として扱う', async () => {
    mockFetch({ ...opened, 'GET /api/conversations/50': () => json(200, detail(50, '別', { workspaceId: 8 })) })
    renderAt('/w/3/c/50')
    expect(await screen.findByRole('heading', { name: 'general', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(M[27])).toBeInTheDocument()
  })

  it('general も見られなければ G-3 に移す', async () => {
    mockFetch({
      ...opened,
      'GET /api/conversations/10': () => json(404, { code: 'CONVERSATION_NOT_FOUND', message: M[27] }),
    })
    renderAt('/w/3/c/10')
    expect(await screen.findByText('G-3')).toBeInTheDocument()
  })
})

describe('ヘッダーとサイドバー（W-9、画面設計書 2.6・2.8）', () => {
  it('ヘッダーとサイドバーにワークスペースの名前を出し、入っているチャンネルを並べる', async () => {
    mockFetch(opened)
    renderAt('/w/3/c/10')
    await screen.findByRole('heading', { name: 'general', level: 1 })
    expect(within(screen.getByRole('banner')).getByRole('link', { name: '仲間うち' })).toHaveAttribute('href', '/w/3')
    const sidebar = screen.getByRole('navigation', { name: '会話' })
    expect(within(sidebar).getByRole('button', { name: '仲間うちのメニュー' })).toBeInTheDocument()
    const links = within(sidebar).getAllByRole('link')
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['🔍チャンネルを探す', '/w/3/channels'],
      ['#general', '/w/3/c/10'],
      ['🔒運営', '/w/3/c/11'],
    ])
    expect(within(sidebar).getByRole('button', { name: 'チャンネルを作る' })).toBeInTheDocument()
    // 開いている会話
    expect(links[1]).toHaveAttribute('aria-current', 'page')
  })

  it('サイドバーのワークスペースの名前のメニューから G-3 に戻れる', async () => {
    mockFetch(opened)
    renderAt('/w/3/c/10')
    await screen.findByRole('heading', { name: 'general', level: 1 })
    await userEvent.click(screen.getByRole('button', { name: '仲間うちのメニュー' }))
    await userEvent.click(within(screen.getByRole('navigation', { name: '会話' })).getByRole('link', { name: 'ワークスペースの一覧' }))
    expect(await screen.findByText('G-3')).toBeInTheDocument()
  })

  it('サイドバーで会話を選ぶと、その会話を開く', async () => {
    mockFetch({
      ...opened,
      'GET /api/conversations/11': () => json(200, detail(11, '運営', { visibility: 'PRIVATE' })),
      'POST /api/conversations/11/read': () => json(204),
    })
    renderAt('/w/3/c/10')
    await screen.findByRole('heading', { name: 'general', level: 1 })
    await userEvent.click(screen.getByRole('link', { name: '運営' }))
    expect(await screen.findByRole('heading', { name: '運営', level: 1 })).toBeInTheDocument()
    expect(url()).toHaveTextContent('/w/3/c/11')
  })
})
