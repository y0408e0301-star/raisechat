import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/AuthContext'
import { M } from '../messages'
import { me } from '../test/render'
import AppHeader from './AppHeader'

// ヘッダー（画面設計書 2.6）。簡単なヘッダー（G-3・G-10）とワークスペース用のヘッダー（G-5 など）

function renderHeader(workspace?: { id: number, name: string, mentionCount?: number }, signOut = vi.fn(async () => {})) {
  render(
    <MemoryRouter>
      <AuthContext value={{ me, signedIn: vi.fn(), signOut }}>
        <AppHeader workspace={workspace && { mentionCount: 0, ...workspace }} />
      </AuthContext>
    </MemoryRouter>,
  )
  return { signOut }
}

describe('AppHeader', () => {
  it('簡単なヘッダー：アプリ名は G-3 へのリンク。自分のアバターに表示名の 1 文字目を出す', () => {
    renderHeader()
    expect(screen.getByRole('link', { name: 'RaiseChat' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('button', { name: 'たろう（@taro_y）のメニュー' })).toHaveTextContent('た')
  })

  it('W-9：ワークスペース用のヘッダーには名前を出し、押すと G-5（最後に開いた会話）', () => {
    renderHeader({ id: 3, name: '仲間うち' })
    expect(screen.getByRole('link', { name: '仲間うち' })).toHaveAttribute('href', '/w/3')
  })

  it('ワークスペース用のヘッダーには「@」と読んでいないメンションの件数を出し、押すと G-7（NT-2・NT-5）', () => {
    renderHeader({ id: 3, name: '仲間うち', mentionCount: 120 })
    const link = screen.getByRole('link', { name: 'メンション 120 件' })
    expect(link).toHaveAttribute('href', '/w/3/mentions')
    expect(link).toHaveTextContent('99+')
  })

  it('ワークスペースの名前は 20 文字を超えたら「…」で省く（絵文字も 1 文字）', () => {
    renderHeader({ id: 3, name: '😀'.repeat(21) })
    expect(screen.getByTitle('😀'.repeat(21))).toHaveTextContent(`${'😀'.repeat(20)}…`)
  })

  it('W-5：自分のアバターを押すと「プロフィールの設定」「ワークスペースの一覧」のメニューを出し、Esc キーで閉じる', async () => {
    renderHeader({ id: 3, name: '仲間うち' })
    const button = screen.getByRole('button', { name: 'たろう（@taro_y）のメニュー' })
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'プロフィールの設定' })).toHaveAttribute('href', '/settings/profile')
    expect(screen.getByRole('link', { name: 'ワークスペースの一覧' })).toHaveAttribute('href', '/')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('link', { name: 'ワークスペースの一覧' })).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('メニューの外を押すと閉じる', async () => {
    renderHeader()
    await userEvent.click(screen.getByRole('button', { name: 'たろう（@taro_y）のメニュー' }))
    await userEvent.click(screen.getByRole('link', { name: 'RaiseChat' }))
    expect(screen.queryByRole('link', { name: 'ワークスペースの一覧' })).not.toBeInTheDocument()
  })

  it('通信が切れたら、ヘッダーのすぐ下に M-50 を出す', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderHeader()
    expect(within(screen.getByRole('banner')).getByRole('alert')).toHaveTextContent(M[50])
  })

  it('ログアウトは確認なしで送り、送っている間は押せない', async () => {
    const { signOut } = renderHeader(undefined, vi.fn(() => new Promise<void>(() => {})))
    await userEvent.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(signOut).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeDisabled()
  })
})
