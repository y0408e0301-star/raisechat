import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Dialog from './Dialog'

// ダイアログ共通（画面設計書 2.5）

function Opener({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>開く</button>
      {open && (
        <Dialog title="見出し" onClose={() => {
          onClose()
          setOpen(false)
        }}>
          <input aria-label="名前" data-autofocus />
          <button type="button">最後</button>
        </Dialog>
      )}
    </>
  )
}

describe('Dialog', () => {
  it('開く前のボタンに戻した後でも、もう一度 data-autofocus に置く（開発中の StrictMode）', async () => {
    render(<StrictMode><Opener /></StrictMode>)
    await userEvent.click(screen.getByRole('button', { name: '開く' }))
    expect(screen.getByLabelText('名前')).toHaveFocus()
  })

  it('data-autofocus がなければダイアログにカーソルを置き、押せる部品がなければ Tab キーでも外に出ない', async () => {
    render(<><Dialog title="見出し" onClose={() => {}}><p>本文</p></Dialog><button type="button">外</button></>)
    expect(screen.getByRole('dialog')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('ダイアログにカーソルがあるとき、Tab キーで中の最初の部品に移る', async () => {
    render(<><Dialog title="見出し" onClose={() => {}}><button type="button">中</button></Dialog><button type="button">外</button></>)
    expect(screen.getByRole('dialog')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: '中' })).toHaveFocus()
  })

  it('見出しで読み上げ、data-autofocus の入力欄にカーソルを置く', async () => {
    render(<Opener />)
    await userEvent.click(screen.getByRole('button', { name: '開く' }))
    expect(screen.getByRole('dialog', { name: '見出し' })).toBeInTheDocument()
    expect(screen.getByLabelText('名前')).toHaveFocus()
  })

  it('Esc キーで閉じ、開く前に押したボタンにカーソルを戻す', async () => {
    const onClose = vi.fn()
    render(<Opener onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: '開く' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '開く' })).toHaveFocus()
  })

  it('Tab キーでダイアログの外に出ない', async () => {
    render(<Opener />)
    await userEvent.click(screen.getByRole('button', { name: '開く' }))
    await userEvent.tab()
    expect(screen.getByRole('button', { name: '最後' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByLabelText('名前')).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: '最後' })).toHaveFocus()
  })

  it('覆いの部分を押すと閉じ、ダイアログの中を押しても閉じない', async () => {
    const onClose = vi.fn()
    render(<Opener onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: '開く' }))
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    // 覆いはダイアログの親
    await userEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
