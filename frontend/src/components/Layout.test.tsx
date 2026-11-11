import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/AuthContext'
import { M } from '../messages'
import { me } from '../test/render'
import Layout from './Layout'

// G-3・G-10 の簡単なヘッダー（画面設計書 2.6）

function renderLayout(path: string, signOut = vi.fn(async () => {})) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext value={{ me, signedIn: vi.fn(), signOut }}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={<p>中身</p>} />
          </Route>
        </Routes>
      </AuthContext>
    </MemoryRouter>,
  )
  return { signOut }
}

describe('Layout', () => {
  it('アプリ名は G-3 へのリンク。自分のアバターに表示名の 1 文字目を出す', () => {
    renderLayout('/settings/profile')
    expect(screen.getByRole('link', { name: 'RaiseChat' })).toHaveAttribute('href', '/')
    expect(screen.getByTitle('たろう（@taro_y）')).toHaveTextContent('た')
    expect(screen.getByText('中身')).toBeInTheDocument()
  })

  it('通信が切れたら、ヘッダーのすぐ下に M-50 を出す', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderLayout('/')
    expect(within(screen.getByRole('banner')).getByRole('alert')).toHaveTextContent(M[50])
  })

  it('ログアウトは確認なしで送り、送っている間は押せない', async () => {
    const { signOut } = renderLayout('/', vi.fn(() => new Promise<void>(() => {})))
    await userEvent.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(signOut).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeDisabled()
  })
})
