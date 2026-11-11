import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MessageBody from './MessageBody'

// メッセージの本文の Markdown（FN-07 MS-6・MS-7、画面設計書 2.10）

function html(body: string): string {
  const { container } = render(<MessageBody body={body} />)
  return (container.firstChild as HTMLElement).innerHTML
}

function text(body: string): string {
  const { container } = render(<MessageBody body={body} />)
  return (container.firstChild as HTMLElement).textContent ?? ''
}

describe('MessageBody', () => {
  // TC-07-5
  it('MS-6 の記法を飾りにする', () => {
    expect(html('**太字** *斜体* _斜体_ ~~取り消し~~ `コード`')).toBe(
      '<p><strong>太字</strong> <em>斜体</em> <em>斜体</em> <del>取り消し</del> <code>コード</code></p>')
    expect(html('```\nconst a = 1\n```')).toBe('<pre><code>const a = 1\n</code></pre>')
    expect(html('> 引用')).toBe('<blockquote>\n<p>引用</p>\n</blockquote>')
    expect(html('- a\n* b')).toContain('<ul>')
    expect(html('1. a\n2. b')).toContain('<ol>')
  })

  it('改行はそのまま改行として出す', () => {
    expect(html('1行目\n2行目')).toMatch(/^<p>1行目<br>\n?2行目<\/p>$/)
  })

  // TC-07-5
  it('見出し・HTML のタグ・画像は書いたままの文字で出す', () => {
    expect(html('# 見出し')).toBe('<p># 見出し</p>')
    expect(html('<b>太字</b>')).toBe('<p>&lt;b&gt;太字&lt;/b&gt;</p>')
    expect(text('![画像](https://example.com/a.png)')).toBe('![画像](https://example.com/a.png)')
    expect(html('![画像](https://example.com/a.png)')).not.toContain('<img')
  })

  it('表・区切り線・チェックボックス・[文字](URL) も書いたままの文字で出す', () => {
    expect(html('| a | b |\n| - | - |\n| 1 | 2 |')).not.toContain('<table')
    expect(text('| a | b |\n| - | - |\n| 1 | 2 |')).toContain('| a | b |')
    expect(html('---')).toBe('<p>---</p>')
    expect(text('- [ ] やること')).toBe('\n[ ] やること\n')
    expect(html('- [ ] やること')).not.toContain('<input')
    expect(html('[ここ](https://example.com)')).toBe('<p>[ここ](https://example.com)</p>')
    expect(html('~1つ~')).toBe('<p>~1つ~</p>')
  })

  it('入れ子にしても、飾らないものは書いたままにする', () => {
    // 箇条書きの中のチェックボックス
    expect(text('- 親\n  - [x] 子')).toContain('[x] 子')
    expect(html('- 親\n  - [x] 子')).not.toContain('<input')
    // 引用の中の URL はリンクにし、[文字](URL) は書いたまま
    expect(html('> https://example.com と [ここ](https://example.com)')).toContain('<a href="https://example.com"')
    expect(text('> https://example.com と [ここ](https://example.com)')).toContain('[ここ](https://example.com)')
    // 太字の中の HTML のタグ
    expect(html('**<b>x</b>**')).toBe('<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>')
  })

  // TC-07-6
  it('script・img のタグは文字のまま出し、実行しない', () => {
    expect(html('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(html('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
    expect(html('文の中の <img src=x onerror=alert(1)> も')).not.toContain('<img')
  })

  // TC-07-6・MS-7
  it('http・https の URL だけをリンクにし、新しいタブで開く', () => {
    expect(html('見て https://example.com/a?b=1 です')).toBe(
      '<p>見て <a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">https://example.com/a?b=1</a> です</p>')
    expect(html('javascript:alert(1)')).toBe('<p>javascript:alert(1)</p>')
    expect(html('<javascript:alert(1)>')).not.toContain('<a')
  })
})
