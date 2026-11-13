import type { ConversationSummary } from '../api'

// サイドバーの並び：チャンネル（general を先頭に、あとは名前の順。大文字・小文字を区別しない。CH-1）の後ろに DM。
// DM は最後のメッセージの新しい順（DM-1）。画面は最後のメッセージの日時を持たないので、
// 通知（conversation.updated。メッセージが送られたときに届く）を受けた DM を DM の先頭に移す
function compare(a: ConversationSummary, b: ConversationSummary): number {
  if (a.general !== b.general) return a.general ? -1 : 1
  const byName = (a.name ?? '').toLowerCase().localeCompare((b.name ?? '').toLowerCase())
  return byName !== 0 ? byName : a.id - b.id
}

// 足すか置き換えて、並べ直す（作った・参加した・招待された・DM にメッセージが届いた。conversation.updated）
export function upsertConversation(list: ConversationSummary[], summary: ConversationSummary): ConversationSummary[] {
  const rest = list.filter((c) => c.id !== summary.id)
  const channels = rest.filter((c) => c.type === 'CHANNEL')
  const dms = rest.filter((c) => c.type === 'DM')
  return summary.type === 'DM'
    ? [...channels, summary, ...dms]
    : [...channels, summary].toSorted(compare).concat(dms)
}

// 消す（退出した・削除された。conversation.removed）
export function removeConversation(list: ConversationSummary[], conversationId: number): ConversationSummary[] {
  return list.some((c) => c.id === conversationId) ? list.filter((c) => c.id !== conversationId) : list
}
