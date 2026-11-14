import { describe, expect, it } from 'vitest'
import { dayKey, endOfDay, formatDayDivider, formatFull, formatTime, formatUntil } from './dates'

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

  it('ステータスを消す時刻は、今日なら時刻だけ、ほかの日は日付も出す', () => {
    const now = new Date('2026-11-14T01:00:00Z')
    expect(formatUntil('2026-11-14T08:00:00Z', now)).toBe('17:00')
    expect(formatUntil('2026-11-14T15:00:00Z', now)).toBe('11月15日 00:00')
  })

  it('今日の終わりは日本時間の 23:59。もう過ぎていれば次の日の 23:59', () => {
    expect(endOfDay(new Date('2026-11-14T01:00:00Z')).toISOString()).toBe('2026-11-14T14:59:00.000Z')
    // 日本時間の 11月14日 23:58
    expect(endOfDay(new Date('2026-11-14T14:58:00Z')).toISOString()).toBe('2026-11-14T14:59:00.000Z')
    // 日本時間の 11月14日 23:59:30
    expect(endOfDay(new Date('2026-11-14T14:59:30Z')).toISOString()).toBe('2026-11-15T14:59:00.000Z')
    // 日本時間の 11月15日 0:30（UTC ではまだ 11月14日）
    expect(endOfDay(new Date('2026-11-14T15:30:00Z')).toISOString()).toBe('2026-11-15T14:59:00.000Z')
  })
})
