import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Avatar from './Avatar'

// ユーザーを表す頭文字の丸（画面設計書 2.7）
describe('Avatar', () => {
  it('表示名の 1 文字目を出す', () => {
    const { container } = render(<Avatar displayName="たろう" size={36} />)
    expect(container.textContent).toBe('た')
  })

  it('1 文字目が絵文字でも 1 文字として出す', () => {
    const { container } = render(<Avatar displayName="😀たろう" size={36} />)
    expect(container.textContent).toBe('😀')
  })

  it('大きさに合わせて丸と文字の大きさを決める', () => {
    const { container } = render(<Avatar displayName="たろう" size={96} />)
    expect(container.firstChild).toHaveStyle({ width: '96px', height: '96px', fontSize: '38px' })
  })
})
