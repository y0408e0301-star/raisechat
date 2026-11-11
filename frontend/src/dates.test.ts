import { describe, expect, it } from 'vitest'
import { dayKey, formatDayDivider, formatFull, formatTime } from './dates'

// 日付・日時の表示（画面設計書 2.13・2.9）。どのタイムゾーンのパソコンでも日本時間で出す
describe('dates', () => {
  it('時刻と、重ねたときの日時を日本時間で出す', () => {
    expect(formatTime('2026-11-10T01:05:09Z')).toBe('10:05')
    expect(formatFull('2026-11-10T01:05:09Z')).toBe('2026/11/10 10:05:09')
    // 日本時間で 0 時台
    expect(formatTime('2026-11-10T15:00:00Z')).toBe('00:00')
  })

  it('同じ日かは日本時間の日付で比べる', () => {
    expect(dayKey('2026-11-10T14:59:59Z')).toBe('2026-11-10')
    expect(dayKey('2026-11-10T15:00:00Z')).toBe('2026-11-11')
  })

  it('日付の区切りは曜日つき。前の年以前は年も出す', () => {
    const now = new Date('2026-11-11T03:00:00Z')
    expect(formatDayDivider('2026-11-10T01:00:00Z', now)).toBe('11月10日（火）')
    expect(formatDayDivider('2025-11-10T01:00:00Z', now)).toBe('2025年11月10日（月）')
  })
})
