import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Avatar from './Avatar'

// ユーザーを表す丸（画面設計書 2.7）
describe('Avatar', () => {
  it('表示名の 1 文字目を出す', () => {
    const { container } = render(<Avatar displayName="たろう" size={36} />)
    expect(container.textContent).toBe('た')
  })

  it('1 文字目が絵文字でも 1 文字として出す', () => {
    const { container } = render(<Avatar displayName="😀たろう" size={36} />)
    expect(container.textContent).toBe('😀')
  })

  it('アバターの画像があれば出す。代わりの文字は「（表示名）のアバター」', () => {
    render(<Avatar displayName="たろう" avatarUrl="https://s3.example/a.png" size={32} />)
    const img = screen.getByRole('img', { name: 'たろうのアバター' })
    expect(img).toHaveAttribute('src', 'https://s3.example/a.png')
    expect(img).toHaveAttribute('width', '32')
  })

  it('画像を読めなければ頭文字を出し、URL が替わればまた試す', () => {
    const { container, rerender } = render(<Avatar displayName="たろう" avatarUrl="https://s3.example/old.png" size={32} />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container.textContent).toBe('た')

    rerender(<Avatar displayName="たろう" avatarUrl="https://s3.example/new.png" size={32} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://s3.example/new.png')
  })

  it('大きさに合わせて丸と文字の大きさを決める', () => {
    const { container } = render(<Avatar displayName="たろう" size={96} />)
    expect(container.firstChild).toHaveStyle({ width: '96px', height: '96px', fontSize: '38px' })
  })
})
