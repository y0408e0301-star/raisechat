import { endOfDay } from '../dates'

// ステータスを消す時刻の選び方（PF-5、画面設計書 12 章）。keep は今の消す時刻のまま（G-10 を開いたときに消す時刻があるときだけ）
export type Expiry = 'keep' | 'never' | '30m' | '1h' | 'today' | '1w'

export const EXPIRY_LABELS: Record<Exclude<Expiry, 'keep'>, string> = {
  never: '消さない',
  '30m': '30 分後',
  '1h': '1 時間後',
  today: '今日の終わり',
  '1w': '1 週間後',
}

const MINUTE = 60 * 1000

// 選んだものを、API に送る日時（ISO 8601）にする。null は「消さない」
export function expiresAt(expiry: Expiry, current: string | null, now: Date = new Date()): string | null {
  switch (expiry) {
    case 'keep': return current
    case 'never': return null
    case '30m': return new Date(now.getTime() + 30 * MINUTE).toISOString()
    case '1h': return new Date(now.getTime() + 60 * MINUTE).toISOString()
    case 'today': return endOfDay(now).toISOString()
    case '1w': return new Date(now.getTime() + 7 * 24 * 60 * MINUTE).toISOString()
  }
}
