import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Me } from '../api'
import { AuthContext, useAuth } from './AuthContext'
import { GuestOnly, RequireAuth } from './guards'

// ログインしていないと開けない画面・ログインしていないときだけの画面（A-10、FN-01 8 章）

const me: Me = { username: 'taro_y', displayName: 'たろう', avatarUrl: null, statusEmoji: null, statusText: null }

// G-1 に移ったとき、ログインした後に開く画面（state.from）を出す
function LoginPage() {
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname
  return <p>G-1（ログインした後は {from ?? 'なし'}）</p>
}

function renderAt(path: string, current: Me | null | undefined) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext value={{ me: current, signedIn: vi.fn(), signOut: vi.fn(async () => {}) }}>
        <Routes>
          <Route element={<GuestOnly />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<p>G-3</p>} />
            <Route path="/w/:ws/members" element={<p>G-9</p>} />
          </Route>
        </Routes>
      </AuthContext>
    </MemoryRouter>,
  )
}

describe('RequireAuth', () => {
  it('ログインしていれば開く', () => {
    renderAt('/w/1/members', me)
    expect(screen.getByText('G-9')).toBeInTheDocument()
  })

  // TC-01-6
  it('ログインしていなければ G-1 に移し、ログインした後に開こうとした画面を渡す', () => {
    renderAt('/w/1/members', null)
    expect(screen.getByText('G-1（ログインした後は /w/1/members）')).toBeInTheDocument()
  })

  it('確かめている途中は何も出さない', () => {
    const { container } = renderAt('/w/1/members', undefined)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('GuestOnly', () => {
  it('ログインしていなければ開く', () => {
    renderAt('/login', null)
    expect(screen.getByText('G-1（ログインした後は なし）')).toBeInTheDocument()
  })

  it('ログインしていれば G-3 に移す', () => {
    renderAt('/login', me)
    expect(screen.getByText('G-3')).toBeInTheDocument()
  })

  it('ログインした直後で、開こうとした画面があればそこへ移す（A-10）', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: { pathname: '/w/1/members', search: '', hash: '' } } }]}>
        <AuthContext value={{ me, signedIn: vi.fn(), signOut: vi.fn(async () => {}) }}>
          <Routes>
            <Route element={<GuestOnly />}>
              <Route path="/login" element={<p>G-1</p>} />
            </Route>
            <Route path="/w/:ws/members" element={<p>G-9</p>} />
          </Routes>
        </AuthContext>
      </MemoryRouter>,
    )
    expect(screen.getByText('G-9')).toBeInTheDocument()
  })

  it('確かめている途中は何も出さない', () => {
    const { container } = renderAt('/login', undefined)
    expect(container).toBeEmptyDOMElement()
  })
})

function UsesAuth() {
  useAuth()
  return null
}

describe('useAuth', () => {
  it('AuthProvider の外では使えない', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<UsesAuth />)).toThrow('AuthProvider の中で使ってください')
  })
})
