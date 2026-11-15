// 本文の「@ユーザー ID」のうち、記録したメンション（MessageView の mentions）だけを目立たせる remark のプラグイン（FN-11 MN-3）。
// 書き方はサーバー（backend の MentionSyntax）と同じ：「@」に続く 3〜15 文字の半角英数字と「_」で、前が英数字・「_」でないもの。
// コード・コードブロックは文（text）にならないので探さない。リンクの中は、押すと G-16 を出すボタンを入れられないので探さない

type Node = {
  type: string
  value?: string
  children?: Node[]
  data?: { hName?: string, hProperties?: Record<string, string> }
}

const MENTION = /(?<![A-Za-z0-9_])@([A-Za-z0-9_]{3,15})(?![A-Za-z0-9_])/g

// メンションの部分。MessageBody が data-mention を見て、押すと G-16 を出すボタンにする
function mentionNode(text: string, username: string): Node {
  return {
    type: 'mention',
    children: [{ type: 'text', value: text }],
    data: { hName: 'span', hProperties: { dataMention: username } },
  }
}

function split(node: Node, usernames: Set<string>): Node[] {
  const value = node.value ?? ''
  const result: Node[] = []
  let last = 0
  for (const match of value.matchAll(MENTION)) {
    const username = match[1].toLowerCase()
    if (!usernames.has(username)) continue
    if (match.index > last) result.push({ type: 'text', value: value.slice(last, match.index) })
    result.push(mentionNode(match[0], username))
    last = match.index + match[0].length
  }
  if (last === 0) return [node]
  if (last < value.length) result.push({ type: 'text', value: value.slice(last) })
  return result
}

function transform(parent: Node, usernames: Set<string>): void {
  if (!parent.children || parent.type === 'link') return
  parent.children = parent.children.flatMap((child) => {
    if (child.type === 'text') return split(child, usernames)
    transform(child, usernames)
    return [child]
  })
}

// usernames は記録したメンションのユーザー ID（小文字）
export default function remarkMentions(usernames: Set<string>) {
  return () => (tree: Node) => {
    if (usernames.size > 0) transform(tree, usernames)
  }
}
