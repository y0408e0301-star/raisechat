import { useEffect, useState } from 'react'
import { fetchMentionCandidates, type MentionCandidate } from '../api'

// 「@」の後の文字が変わってから候補を読むまで待つ時間（FN-11 3.1）
export const SUGGEST_DELAY_MS = 200

// 候補の文字の長さ（FN-11 4 章）
const QUERY_MAX = 30

// 入力の位置（caret）の直前の「@〜」。「@」の前は文の始まりか英数字・「_」以外（メールアドレスでは出さない。5 章の 1）。
// 表示名でも探せるので、「@」の後は空白と「@」以外なら何でもよい。start は「@」の位置
export function mentionQuery(value: string, caret: number): { start: number, text: string } | null {
  const match = /(?:^|[^A-Za-z0-9_])@([^\s@]*)$/.exec(value.slice(0, caret))
  if (!match || [...match[1]].length > QUERY_MAX) return null
  return { start: caret - match[1].length - 1, text: match[1] }
}

// 候補を選んだ後の本文と入力の位置。「@〜」を「@ユーザー ID 」に置き換える（MN-1）。
// 後ろがもう空白なら空白は足さず、その空白の後に入力の位置を置く
export function insertMention(value: string, caret: number, start: number, username: string) {
  const rest = value.slice(caret)
  const inserted = rest.startsWith(' ') ? `@${username}` : `@${username} `
  return { value: value.slice(0, start) + inserted + rest, caret: start + `@${username} `.length }
}

// メンションの候補（MN-1）。conversationId がなければ出さない。start は「@」の位置、text はその後の文字。
// 読み込みに失敗したとき・一致する人がいないときは出さない（FN-11 9 章）
export function useMentionCandidates(conversationId: number | undefined, start: number | null,
  text: string | null): MentionCandidate[] {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (conversationId === undefined || start === null || text === null) return
    let active = true
    const timer = window.setTimeout(async () => {
      let candidates: MentionCandidate[] = []
      try {
        candidates = await fetchMentionCandidates(conversationId, text)
      } catch {
        // 候補を出さない
      }
      if (active) setLoaded({ conversationId, start, text, candidates })
    }, SUGGEST_DELAY_MS)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [conversationId, start, text])

  // 同じ会話の同じ「@」の後に打ち足している間は、次を読み終わるまで前の候補を出したままにする（1 文字ごとに消えてちらつかないように）。
  // ほかの会話や、前より短くしたとき（消したとき・送った後にまた打った「@」）は、前の候補を出さない
  const continues = loaded !== null && loaded.conversationId === conversationId && loaded.start === start
    && text !== null && text.startsWith(loaded.text)
  return continues ? loaded.candidates : []
}

type Loaded = { conversationId: number, start: number, text: string, candidates: MentionCandidate[] }
