import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { M } from '../messages'
import { json, mockFetch, sentJson } from '../test/fetchMock'
import { me, renderComponent } from '../test/render'
import WorkspacesPage from './WorkspacesPage'

// G-3 ワークスペースの一覧画面と G-12 ワークスペースの作成ダイアログ（FN-03 W-1〜W-3）

const summary = (id: number, name: string, extra: object = {}) =>
  ({ id, name, role: 'MEMBER', hasUnread: false, mentionCount: 0, ...extra })

const detail = {
  ...summary(5, '仲間うち', { role: 'OWNER' }), owner: me, memberCount: 1, generalConversationId: 9,
  lastOpenedConversationId: null,
}

describe('G-3 ワークスペースの一覧（W-1・W-2）', () => {
  // TC-03-4
  it('API の順に出し、オーナーの印・未読の太字・メンションの件数を出す。選ぶと G-5', async () => {
    mockFetch({
      'GET /api/workspaces': () => json(200, [
        summary(2, '仲間うち', { role: 'OWNER' }),
        summary(1, '旅行サークル', { hasUnread: true, mentionCount: 3 }),
        summary(3, '大きな会', { mentionCount: 120 }),
      ]),
    })
    renderComponent(<WorkspacesPage />)
    const links = await screen.findAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/w/2', '/w/1', '/w/3'])
    expect(links[0]).toHaveTextContent('オーナー')
    expect(links[1]).not.toHaveTextContent('オーナー')
    expect(screen.getByText('旅行サークル').parentElement?.className).toMatch(/unread/)
    expect(screen.getByText('仲間うち').parentElement?.className).not.toMatch(/unread/)
    expect(screen.getByLabelText('メンション 3 件')).toHaveTextContent('3')
    expect(screen.getByLabelText('メンション 120 件')).toHaveTextContent('99+')
  })

  it('M-16：入っているワークスペースがない', async () => {
    mockFetch({ 'GET /api/workspaces': () => json(200, []) })
    renderComponent(<WorkspacesPage />)
    expect(await screen.findByText(M[16])).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ワークスペースを作る' })).toBeInTheDocument()
  })

  it('M-48：読み込みに失敗したら「再読み込み」で読み込み直す', async () => {
    mockFetch({
      'GET /api/workspaces': [() => json(500, { code: 'INTERNAL_ERROR', message: M[49] }), () => json(200, [])],
    })
    renderComponent(<WorkspacesPage />)
    expect(await screen.findByText(M[48])).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '再読み込み' }))
    expect(await screen.findByText(M[16])).toBeInTheDocument()
  })
})

// G-3 を開いて「ワークスペースを作る」を押す
async function openDialog(routes = {}) {
  const fetch = mockFetch({ 'GET /api/workspaces': () => json(200, []), ...routes })
  renderComponent(<WorkspacesPage />)
  await userEvent.click(await screen.findByRole('button', { name: 'ワークスペースを作る' }))
  return fetch
}

describe('G-12 ワークスペースの作成（W-3）', () => {
  // TC-03-2
  it('名前を入れて「作る」を押すと、前後の空白を取って送り、G-5 で general を開く', async () => {
    const fetch = await openDialog({ 'POST /api/workspaces': () => json(201, detail) })
    expect(screen.getByRole('dialog', { name: 'ワークスペースを作る' })).toBeInTheDocument()
    expect(screen.getByLabelText('名前')).toHaveFocus()
    await userEvent.type(screen.getByLabelText('名前'), ' 仲間うち {Enter}')
    expect(await screen.findByRole('status', { name: '今の URL' })).toHaveTextContent('/w/5/c/9')
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/workspaces'))).toEqual({ name: '仲間うち' })
  })

  // TC-03-1
  it('M-11：空白だけなら送らずに入力欄の下に出す', async () => {
    const fetch = await openDialog()
    await userEvent.type(screen.getByLabelText('名前'), '　 ')
    await userEvent.click(screen.getByRole('button', { name: '作る' }))
    expect(screen.getByText(M[11])).toBeInTheDocument()
    expect(screen.getByLabelText('名前')).toHaveAttribute('aria-invalid', 'true')
    expect(fetch.keys()).not.toContain('POST /api/workspaces')
  })

  // TC-03-1
  it('51 文字目（コードポイント）は入力できない', async () => {
    await openDialog()
    await userEvent.click(screen.getByLabelText('名前'))
    await userEvent.paste('😀'.repeat(51))
    expect(Array.from((screen.getByLabelText('名前') as HTMLInputElement).value)).toHaveLength(50)
  })

  // TC-03-3
  it('M-12：上限のときは入力欄の下に API のメッセージを出し、ダイアログは開いたまま', async () => {
    await openDialog({ 'POST /api/workspaces': () => json(409, { code: 'WORKSPACE_LIMIT', message: M[12], field: null }) })
    await userEvent.type(screen.getByLabelText('名前'), '11 個目')
    await userEvent.click(screen.getByRole('button', { name: '作る' }))
    expect(await screen.findByText(M[12])).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '作る' })).toBeEnabled()
  })

  it('それ以外の失敗はトーストで出す', async () => {
    await openDialog({ 'POST /api/workspaces': () => json(500, { code: 'INTERNAL_ERROR', message: M[49], field: null }) })
    await userEvent.type(screen.getByLabelText('名前'), '仲間うち')
    await userEvent.click(screen.getByRole('button', { name: '作る' }))
    expect(await screen.findByText(M[49])).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('送っている間は「作成中…」で押せない。「キャンセル」で閉じる', async () => {
    await openDialog({ 'POST /api/workspaces': () => new Promise<Response>(() => {}) })
    await userEvent.type(screen.getByLabelText('名前'), '仲間うち')
    await userEvent.click(screen.getByRole('button', { name: '作る' }))
    expect(screen.getByRole('button', { name: '作成中…' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
