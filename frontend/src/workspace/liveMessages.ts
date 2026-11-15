import type { MessageView, ReactionView, UserSummary } from '../api'
import type { RealtimeEvent } from '../realtime/events'
import type { Entry } from './entries'

type Pending = Extract<Entry, { kind: 'pending' }>

// 見ている人 me と、その人がワークスペースのオーナーか
export type Viewer = { me: UserSummary, owner: boolean }

// 通知で届いた MessageView の mine・canDelete・reactedByMe は false なので、見ている人に合わせて直す（機能定義書 4.3）。
// previous は、いま出しているそのメッセージ（reactedByMe を直すのに使う）
export function forViewer(message: MessageView, viewer: Viewer, previous?: MessageView): MessageView {
  const mine = message.author.username === viewer.me.username
  return {
    ...message, mine, canDelete: !message.deleted && (mine || viewer.owner),
    reactions: reactionsForViewer(message.reactions, viewer, previous?.reactions),
  }
}

// 通知で届いたリアクションの reactedByMe を、付けた人（users）に自分がいるかで直す（FN-10 5 章の 4）。
// users は 20 人までなので、21 人目より後に付けた自分は users にいない。そのときは、いま出している状態を残す
// （ほかの人の操作では、自分が付けたかは変わらない）。API の応答の reactedByMe（true）はそのまま使う
export function reactionsForViewer(reactions: ReactionView[], viewer: Viewer,
  previous: ReactionView[] = []): ReactionView[] {
  return reactions.map((r) => {
    const listed = r.users.some((u) => u.username === viewer.me.username)
    const hidden = r.count > r.users.length && (previous.find((p) => p.emoji === r.emoji)?.reactedByMe ?? false)
    return { ...r, reactedByMe: r.reactedByMe || listed || hidden }
  })
}

// 1 つのメッセージのリアクションを置き換える
export function replaceReactions(message: MessageView, reactions: ReactionView[], viewer: Viewer): MessageView {
  return { ...message, reactions: reactionsForViewer(reactions, viewer, message.reactions) }
}

// ID の順に並べたまま足す。同じ ID がもうあれば足さない（API の応答と通知の両方が届くため。FN-07 5 章の 7）
export function addMessage(items: MessageView[], message: MessageView): MessageView[] {
  if (items.some((m) => m.id === message.id)) return items
  const last = items.at(-1)
  if (!last || last.id < message.id) return [...items, message]
  return [...items, message].toSorted((a, b) => a.id - b.id)
}

// 会話のメッセージの一覧に、通知を当てはめる。スレッドの返信（parentId があるもの）は、スレッド（1-12）で扱う
export function applyEvent(items: MessageView[], event: RealtimeEvent, viewer: Viewer): MessageView[] {
  switch (event.type) {
    case 'message.created':
      return event.payload.parentId === null ? addMessage(items, forViewer(event.payload, viewer)) : items
    case 'message.updated':
      return items.map((m) => (m.id === event.payload.id ? forViewer(event.payload, viewer, m) : m))
    case 'message.deleted':
      return items.filter((m) => m.id !== event.payload.id)
    case 'reaction.updated': {
      const { messageId, reactions } = event.payload
      return items.map((m) => (m.id === messageId ? replaceReactions(m, reactions, viewer) : m))
    }
    default:
      return items
  }
}

// 自分が送ったものの通知が API の応答より先に届いたときは、同じ本文の「送信中」を 1 つ消す。
// 届いた通知には clientId がないので本文で見分ける（サーバーは前後の空白を除き、改行を LF にそろえて保存する）
export function settlePending(pending: Pending[], event: RealtimeEvent, viewer: Viewer): Pending[] {
  if (event.type !== 'message.created' || event.payload.author.username !== viewer.me.username) return pending
  const body = event.payload.body
  const index = pending.findIndex((p) => !p.failed && p.body.replace(/\r\n?/g, '\n').trim() === body)
  return index < 0 ? pending : pending.filter((_, i) => i !== index)
}
