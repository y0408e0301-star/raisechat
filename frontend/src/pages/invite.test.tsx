import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { M } from '../messages'
import CurrentLocation from '../test/CurrentLocation'
import { json, mockFetch, type Handler } from '../test/fetchMock'
import { me } from '../test/render'
import { opened, workspace } from '../test/workspace'

// G-4 招待の参加画面（FN-04 I-4〜I-7、TC-04-2〜TC-04-6）。ログインの流れも含めて App 全体で確かめる

const TOKEN = 'Xa9'.padEnd(43, 'b')
const PREVIEW = `GET /api/invites/${TOKEN}`
const ACCEPT = `POST /api/invites/${TOKEN}/accept`

const location = () => screen.getByRole('status', { name: '今の URL' })

const notLoggedIn = {
  'GET /api/auth/me': () => json(401, { code: 'UNAUTHENTICATED', message: '…' }),
  'POST /api/auth/refresh': () => json(401, { code: 'REFRESH_FAILED', message: '…' }),
}
const loggedIn = { 'GET /api/auth/me': () => json(200, me) }

const guestPreview = () => json(200, {
  workspaceName: '仲間うち', workspaceId: null, ownerDisplayName: null, memberCount: null, alreadyMember: null,
})
const memberPreview = (extra: object = {}) => () => json(200, {
  workspaceName: '仲間うち', workspaceId: 3, ownerDisplayName: 'たろう', memberCount: 12, alreadyMember: false, ...extra,
})
const invalid = () => json(410, { code: 'INVITE_INVALID', message: M[18] })

function open(routes: Record<string, Handler | Handler[]>) {
  const fetch = mockFetch({ ...opened, ...routes })
  render(<MemoryRouter initialEntries={[`/invite/${TOKEN}`]}><App /><CurrentLocation /></MemoryRouter>)
  return fetch
}

describe('ログインしていない人（I-4、TC-04-2）', () => {
  it('ワークスペースの名前と「ログイン」「アカウントを作る」だけを出す', async () => {
    open({ ...notLoggedIn, [PREVIEW]: guestPreview })

    expect(await screen.findByText('「仲間うち」に招待されています')).toBeInTheDocument()
    expect(screen.queryByText(/オーナー/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '参加する' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'アカウントを作る' })).toBeInTheDocument()
  })

  it('ログインすると G-4 に戻り、オーナー・人数と「参加する」を出す', async () => {
    open({
      ...notLoggedIn,
      [PREVIEW]: [guestPreview, memberPreview()],
      'POST /api/auth/login': () => json(200, me),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'ログイン' }))
    expect(location()).toHaveTextContent('/login')
    await user.type(screen.getByLabelText('ユーザー ID'), 'taro_y')
    await user.type(screen.getByLabelText('パスワード'), 'password1')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    expect(await screen.findByText('オーナー：たろう · メンバー 12 人')).toBeInTheDocument()
    expect(location()).toHaveTextContent(`/invite/${TOKEN}`)
    expect(screen.getByRole('button', { name: '参加する' })).toBeInTheDocument()
  })

  it('G-2 で登録しても G-4 に戻る', async () => {
    open({
      ...notLoggedIn,
      [PREVIEW]: [guestPreview, memberPreview()],
      'GET /api/auth/username-availability?username=jiro': () => json(200, { available: true }),
      'POST /api/auth/signup': () => json(201, me),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'アカウントを作る' }))
    expect(location()).toHaveTextContent('/signup')
    await user.type(screen.getByLabelText('ユーザー ID'), 'jiro')
    await user.type(screen.getByLabelText('表示名'), 'じろう')
    await user.type(screen.getByLabelText('パスワード'), 'password1')
    await user.type(screen.getByLabelText('パスワード（確認）'), 'password1')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByRole('button', { name: '参加する' })).toBeInTheDocument()
    expect(location()).toHaveTextContent(`/invite/${TOKEN}`)
  })
})

describe('ログインしている人（I-5〜I-7）', () => {
  it('「参加する」で参加し、G-5 で general を開く（TC-04-3）', async () => {
    const fetch = open({ ...loggedIn, [PREVIEW]: memberPreview(), [ACCEPT]: () => json(200, workspace({ role: 'MEMBER' })) })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: '参加する' }))

    await vi.waitFor(() => expect(location()).toHaveTextContent('/w/3/c/10'))
    expect(fetch.keys()).toContain(ACCEPT)
    expect(await screen.findByRole('heading', { level: 1, name: /general/ })).toBeInTheDocument()
  })

  it('すでにメンバーなら M-19 を出して G-5 に移す（TC-04-6）', async () => {
    open({ ...loggedIn, [PREVIEW]: memberPreview({ alreadyMember: true }) })

    expect(await screen.findByText(M[19])).toBeInTheDocument()
    await vi.waitFor(() => expect(location()).toHaveTextContent('/w/3/c/10'))
  })

  it('使えない招待リンクは M-18 と「ワークスペースの一覧へ」を出し、名前は出さない（TC-04-4）', async () => {
    open({ ...loggedIn, [PREVIEW]: invalid })

    expect(await screen.findByRole('alert')).toHaveTextContent(M[18])
    expect(screen.queryByText(/仲間うち/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ワークスペースの一覧へ' })).toHaveAttribute('href', '/')
  })

  it('開いた後に取り消されていたら、「参加する」で M-18 を出す（TC-04-5）', async () => {
    open({ ...loggedIn, [PREVIEW]: memberPreview(), [ACCEPT]: invalid })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: '参加する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M[18])
    expect(screen.queryByRole('button', { name: '参加する' })).not.toBeInTheDocument()
    expect(location()).toHaveTextContent(`/invite/${TOKEN}`)
  })
})

describe('ログインしていない人の使えない招待リンク（I-6）', () => {
  it('M-18 だけを出し、「ワークスペースの一覧へ」は出さない', async () => {
    open({ ...notLoggedIn, [PREVIEW]: invalid })

    expect(await screen.findByRole('alert')).toHaveTextContent(M[18])
    expect(screen.queryByRole('link', { name: 'ワークスペースの一覧へ' })).not.toBeInTheDocument()
  })
})
