import type { ConversationSummary } from '../api'

// サイドバーのチャンネルの並び：general を先頭に、あとは名前の順（大文字・小文字を区別しない。CH-1）
function compare(a: ConversationSummary, b: ConversationSummary): number {
  if (a.general !== b.general) return a.general ? -1 : 1
  const byName = (a.name ?? '').toLowerCase().localeCompare((b.name ?? '').toLowerCase())
  return byName !== 0 ? byName : a.id - b.id
}

// 足すか置き換えて、並べ直す（作った・参加した・招待された。conversation.updated）
export function upsertConversation(list: ConversationSummary[], summary: ConversationSummary): ConversationSummary[] {
  return [...list.filter((c) => c.id !== summary.id), summary].toSorted(compare)
}

// 消す（退出した・削除された。conversation.removed）
export function removeConversation(list: ConversationSummary[], conversationId: number): ConversationSummary[] {
  return list.some((c) => c.id === conversationId) ? list.filter((c) => c.id !== conversationId) : list
}
