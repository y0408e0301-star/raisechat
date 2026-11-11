// メッセージの本文で飾りにする Markdown 記法を、機能定義書 FN-07 MS-6 のものだけにする remark のプラグイン。
// remark（CommonMark と GFM）が読み取ったもののうち、MS-6 にないもの（見出し・表・画像・HTML のタグ・区切り線・
// [文字](URL) の形のリンク・脚注など）を、本文に書いたままの文字に戻す。
// あわせて、段落の中の改行をそのまま改行として出す（MS-6「改行はそのまま出す」）

type Point = { offset?: number }

type Node = {
  type: string
  value?: string
  children?: Node[]
  checked?: boolean | null
  position?: { start: Point, end: Point }
}

// 段落などのまとまりとして出てくるもの。文字に戻すときは段落にする
const BLOCKS_AS_TEXT = new Set(['heading', 'table', 'thematicBreak', 'definition', 'footnoteDefinition'])

// 文の中に出てくるもの
const INLINES_AS_TEXT = new Set(['image', 'imageReference', 'linkReference', 'footnoteReference'])

// 文の中の部品（この中の html は文の中のもの）
const PHRASING_PARENTS = new Set(['paragraph', 'emphasis', 'strong', 'delete', 'link', 'heading', 'tableCell'])

function source(node: Node, text: string): string {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? (node.value ?? '') : text.slice(start, end)
}

function textNode(value: string): Node {
  return { type: 'text', value }
}

// 改行を含む文を、文と改行（break）に分ける
function splitLines(node: Node): Node[] {
  const lines = (node.value ?? '').split('\n')
  return lines.flatMap((line, i) => (i === 0 ? [textNode(line)] : [{ type: 'break' }, textNode(line)]))
}

function transform(parent: Node, text: string): void {
  if (!parent.children) return
  const inline = PHRASING_PARENTS.has(parent.type)
  parent.children = parent.children.flatMap((child): Node[] => {
    if (BLOCKS_AS_TEXT.has(child.type) || (child.type === 'html' && !inline)) {
      return [{ type: 'paragraph', children: splitLines(textNode(source(child, text))) }]
    }
    if (INLINES_AS_TEXT.has(child.type) || child.type === 'html') {
      return splitLines(textNode(source(child, text)))
    }
    // URL がそのまま書かれたもの（GFM の自動のリンク）と <URL> だけをリンクにし、[文字](URL) は書いたままにする（MS-7）
    if (child.type === 'link' && source(child, text).startsWith('[')) {
      return splitLines(textNode(source(child, text)))
    }
    if (child.type === 'text') return splitLines(child)
    // GFM のチェックボックス（- [ ] ）は飾りにせず、[ ] の文字を戻す
    if (child.type === 'listItem' && typeof child.checked === 'boolean') {
      const mark = child.checked ? '[x] ' : '[ ] '
      child.checked = null
      const first = child.children?.[0]
      if (first?.type === 'paragraph') first.children = [textNode(mark), ...(first.children ?? [])]
    }
    transform(child, text)
    return [child]
  })
}

export default function remarkChatSyntax() {
  return (tree: Node, file: { value: unknown }) => {
    transform(tree, String(file.value))
  }
}
