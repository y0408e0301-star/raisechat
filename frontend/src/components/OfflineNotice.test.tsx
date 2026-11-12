import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { M } from '../messages'
import type { ConnectionState } from '../realtime/connection'
import { RealtimeContext } from '../realtime/RealtimeContext'
import OfflineNotice from './OfflineNotice'

// 通信切れのお知らせ欄（M-50・M-37、画面設計書 2.4・2.20）

function renderWith(state: ConnectionState) {
  return render(
    <RealtimeContext value={{ state, subscribeConversation: () => () => {}, subscribeUser: () => () => {}, onReconnect: () => () => {} }}>
      <OfflineNotice />
    </RealtimeContext>,
  )
}

function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
}

function goOffline() {
  setOnline(false)
  act(() => { window.dispatchEvent(new Event('offline')) })
}

function goOnline() {
  setOnline(true)
  act(() => { window.dispatchEvent(new Event('online')) })
}

describe('OfflineNotice', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('つながっている間は何も出さない', () => {
    setOnline(true)
    render(<OfflineNotice />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('接続が切れたら M-50 を出し、戻ったら消す', () => {
    setOnline(true)
    render(<OfflineNotice />)
    goOffline()
    expect(screen.getByRole('alert')).toHaveTextContent(M[50])
    goOnline()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('開いた時点で切れていれば、はじめから M-50 を出す', () => {
    setOnline(false)
    render(<OfflineNotice />)
    expect(screen.getByRole('alert')).toHaveTextContent(M[50])
  })

  it('WebSocket が切れてつなぎ直している間は M-37 を出す。つないでいる・つなぎ始めは出さない', () => {
    setOnline(true)
    const { rerender } = renderWith('lost')
    expect(screen.getByRole('alert')).toHaveTextContent(M[37])
    for (const state of ['connected', 'connecting', 'idle'] as const) {
      rerender(
        <RealtimeContext value={{ state, subscribeConversation: () => () => {}, subscribeUser: () => () => {}, onReconnect: () => () => {} }}>
          <OfflineNotice />
        </RealtimeContext>,
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    }
  })

  it('インターネットにつながっていないときは、M-37 の代わりに M-50 だけを出す', () => {
    setOnline(false)
    renderWith('lost')
    expect(screen.getByRole('alert')).toHaveTextContent(M[50])
    expect(screen.queryByText(M[37])).not.toBeInTheDocument()
  })
})
