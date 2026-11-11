import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import App from './App'
import { M } from './messages'
import { json, mockFetch } from './test/fetchMock'
import { me } from './test/render'

// 仮の G-3 に出す文
const G3 = M[16]

// ログインした後に開く画面の API。ワークスペースはまだない。/w/1 は入っていないので 404（M-13 を出して G-3 に移る）
const afterLogin = {
  'GET /api/workspaces': () => json(200, []),
  'GET /api/workspaces/1': () => json(404, { code: 'WORKSPACE_NOT_FOUND', message: M[13] }),
  'GET /api/workspaces/1/conversations': () => json(404, { code: 'WORKSPACE_NOT_FOUND', message: M[13] }),
}

const notLoggedIn = {
  'GET /api/auth/me': () => json(401, { code: 'UNAUTHENTICATED', message: '…' }),
  'POST /api/auth/refresh': () => json(401, { code: 'REFRESH_FAILED', message: '…' }),
  ...afterLogin,
}

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

describe('ログイン（G-1）', () => {
  it('ログインしていなければ G-1 を出し、ログインすると G-3 に移る', async () => {
    mockFetch({ ...notLoggedIn, 'POST /api/auth/login': () => json(200, me) })
    renderAt('/')
    const button = await screen.findByRole('button', { name: 'ログイン' })
    // どちらかが空のときは押せない
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText('ユーザー ID'), 'taro_y')
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText('パスワード'), 'password1')
    await userEvent.click(button)
    expect(await screen.findByText(G3)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'たろう（@taro_y）のメニュー' })).toBeInTheDocument()
  })

  it('失敗したら API のメッセージをフォームの上に出す', async () => {
    mockFetch({
      ...notLoggedIn,
      'POST /api/auth/login': () => json(401, { code: 'LOGIN_FAILED', message: 'ユーザー ID かパスワードが違います。' }),
    })
    renderAt('/login')
    await userEvent.type(await screen.findByLabelText('ユーザー ID'), 'taro_y')
    await userEvent.type(screen.getByLabelText('パスワード'), 'wrong1234')
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ユーザー ID かパスワードが違います。')
  })

  it('ログインしていれば G-1 を開いても G-3 に移る', async () => {
    mockFetch({ 'GET /api/auth/me': () => json(200, me), ...afterLogin })
    renderAt('/login')
    expect(await screen.findByText(G3)).toBeInTheDocument()
  })

  it('ログアウトすると G-1 に戻る', async () => {
    const fetch = mockFetch({ 'GET /api/auth/me': () => json(200, me), 'POST /api/auth/logout': () => json(204), ...afterLogin })
    renderAt('/')
    await userEvent.click(await screen.findByRole('button', { name: 'ログアウト' }))
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeInTheDocument()
    expect(fetch.keys()).toContain('POST /api/auth/logout')
  })
})

describe('ユーザー登録（G-2）', () => {
  it('条件に合わない項目の下にメッセージを出し、送らない', async () => {
    const fetch = mockFetch(notLoggedIn)
    renderAt('/signup')
    await userEvent.type(await screen.findByLabelText('ユーザー ID'), 'ab')
    await userEvent.type(screen.getByLabelText('パスワード'), 'password')
    await userEvent.type(screen.getByLabelText('パスワード（確認）'), 'passw0rd')
    await userEvent.click(screen.getByRole('button', { name: '登録する' }))
    expect(screen.getByText('ユーザー ID は 3〜15 文字の半角英数字と「_」で入力してください。')).toBeInTheDocument()
    expect(screen.getByText('表示名を入力してください。')).toBeInTheDocument()
    expect(screen.getByText('パスワードは英字と数字を含む 8〜64 文字の半角文字で入力してください。')).toBeInTheDocument()
    expect(screen.getByText('パスワード（確認）が一致しません。')).toBeInTheDocument()
    expect(screen.getByLabelText('ユーザー ID')).toHaveFocus()
    expect(fetch.keys()).not.toContain('POST /api/auth/signup')
  })

  it('ユーザー ID の入力欄から離れたとき、使われていれば M-1 を出す', async () => {
    mockFetch({
      ...notLoggedIn,
      'GET /api/auth/username-availability?username=taro_y': () => json(200, { available: false }),
    })
    renderAt('/signup')
    await userEvent.type(await screen.findByLabelText('ユーザー ID'), 'taro_y')
    await userEvent.tab()
    expect(await screen.findByText('このユーザー ID は使われています。')).toBeInTheDocument()
  })

  it('表示名は 30 文字（コードポイント）まで。絵文字も 1 文字と数え、31 文字目は入力できない', async () => {
    mockFetch(notLoggedIn)
    renderAt('/signup')
    await userEvent.click(await screen.findByLabelText('表示名'))
    await userEvent.paste('😀'.repeat(31))
    expect(Array.from((screen.getByLabelText('表示名') as HTMLInputElement).value)).toHaveLength(30)
  })

  it('登録すると G-3 に移る', async () => {
    const fetch = mockFetch({
      ...notLoggedIn,
      'GET /api/auth/username-availability?username=hanako': () => json(200, { available: true }),
      'POST /api/auth/signup': () => json(201, { ...me, username: 'hanako', displayName: 'はなこ' }),
    })
    renderAt('/signup')
    await userEvent.type(await screen.findByLabelText('ユーザー ID'), ' hanako ')
    await userEvent.type(screen.getByLabelText('表示名'), 'はなこ')
    await userEvent.type(screen.getByLabelText('パスワード'), 'password1')
    await userEvent.type(screen.getByLabelText('パスワード（確認）'), 'password1')
    await userEvent.click(screen.getByRole('button', { name: '登録する' }))
    expect(await screen.findByText(G3)).toBeInTheDocument()
    const sent = fetch.calls.find((c) => c.key === 'POST /api/auth/signup')
    expect(JSON.parse(sent?.init?.body as string)).toEqual({ username: 'hanako', displayName: 'はなこ', password: 'password1' })
  })
})

// TC-01-6。ログインした後に開こうとした URL（入っていないワークスペースなので、そこから G-3 へ移る）へ移ったかを確かめる
describe('ログインしていないときに開いた画面（A-10）', () => {
  it('G-1 → G-2 で登録すると、開こうとした画面へ移す', async () => {
    mockFetch({
      ...notLoggedIn,
      'GET /api/auth/username-availability?username=hanako': () => json(200, { available: true }),
      'POST /api/auth/signup': () => json(201, { ...me, username: 'hanako', displayName: 'はなこ' }),
    })
    const history: string[] = []
    render(
      <MemoryRouter initialEntries={['/w/1/c/2']}>
        <App />
        <LocationLog history={history} />
      </MemoryRouter>,
    )
    await userEvent.click(await screen.findByRole('link', { name: 'アカウントを作る' }))
    // G-2 から G-1 へ戻り、もう一度 G-2 へ移っても、開こうとした画面を覚えている
    await userEvent.click(screen.getByRole('link', { name: 'ログインはこちら' }))
    await userEvent.click(screen.getByRole('link', { name: 'アカウントを作る' }))
    await userEvent.type(screen.getByLabelText('ユーザー ID'), 'hanako')
    await userEvent.type(screen.getByLabelText('表示名'), 'はなこ')
    await userEvent.type(screen.getByLabelText('パスワード'), 'password1')
    await userEvent.type(screen.getByLabelText('パスワード（確認）'), 'password1')
    await userEvent.click(screen.getByRole('button', { name: '登録する' }))
    expect(await screen.findByText(G3)).toBeInTheDocument()
    expect(history.slice(-2)).toEqual(['/w/1/c/2', '/'])
  })

  it('ログインすると、開こうとした画面へ移す', async () => {
    mockFetch({ ...notLoggedIn, 'POST /api/auth/login': () => json(200, me) })
    const history: string[] = []
    render(
      <MemoryRouter initialEntries={['/w/1/c/2?m=5']}>
        <App />
        <LocationLog history={history} />
      </MemoryRouter>,
    )
    await userEvent.type(await screen.findByLabelText('ユーザー ID'), 'taro_y')
    await userEvent.type(screen.getByLabelText('パスワード'), 'password1')
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    expect(await screen.findByText(G3)).toBeInTheDocument()
    expect(history.slice(-2)).toEqual(['/w/1/c/2?m=5', '/'])
  })
})

// 移った URL を順に残す
function LocationLog({ history }: { history: string[] }) {
  const location = useLocation()
  const url = location.pathname + location.search
  if (history.at(-1) !== url) history.push(url)
  return null
}
