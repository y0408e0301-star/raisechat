import type { Me, ReactionView } from '../api'

// 付けた人として出す人数（API の users と同じ。RE-4）
export const MAX_REACTION_USERS = 20

// 異体字セレクタ（U+FE0F）の有無だけが違う絵文字は同じとみなす（絵文字の一覧が「👍️」を返すことがある。FN-10 4 章）
export function sameEmoji(a: string, b: string): boolean {
  return a.replaceAll('\uFE0F', '') === b.replaceAll('\uFE0F', '')
}

// 押したらすぐに出す表示（RE-3。API の応答を待たない）。on なら自分を足し、そうでなければ外す。
// 新しい絵文字は最後に足し（最初に付けられた順。RE-5）、0 件になった絵文字は消す
export function toggled(reactions: ReactionView[], emoji: string, me: Me, on: boolean): ReactionView[] {
  const current = reactions.find((r) => sameEmoji(r.emoji, emoji))
  if (on) {
    if (current?.reactedByMe) return reactions
    const user = { username: me.username, displayName: me.displayName }
    if (!current) return [...reactions, { emoji, count: 1, reactedByMe: true, users: [user] }]
    return reactions.map((r) => (sameEmoji(r.emoji, emoji)
      ? {
          ...r, count: r.count + 1, reactedByMe: true,
          users: r.users.length < MAX_REACTION_USERS ? [...r.users, user] : r.users,
        }
      : r))
  }
  if (!current?.reactedByMe) return reactions
  if (current.count <= 1) return reactions.filter((r) => !sameEmoji(r.emoji, emoji))
  return reactions.map((r) => (sameEmoji(r.emoji, emoji)
    ? { ...r, count: r.count - 1, reactedByMe: false, users: r.users.filter((u) => u.username !== me.username) }
    : r))
}

// 重ねたときに出す、付けた人（付けた順）。21 人目からは「ほか N 人」（RE-4）
export function reactorNames(reaction: ReactionView): string {
  const names = reaction.users.map((u) => u.displayName)
  const others = reaction.count - reaction.users.length
  return others > 0 ? [...names, `ほか ${others} 人`].join('、') : names.join('、')
}

// 読み上げ（画面設計書 2.11。色だけで区別しない。N-30）
export function reactionLabel(reaction: ReactionView): string {
  return `${reaction.emoji} ${reaction.count} 件${reaction.reactedByMe ? '、自分も付けた' : ''}`
}
