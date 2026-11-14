import { describe, expect, it } from 'vitest'
import { expiresAt } from './status'

// ステータスを消す時刻の選び方（PF-5）
describe('expiresAt', () => {
  const now = new Date('2026-11-14T01:00:00Z')

  it('選んだものを日時にする', () => {
    expect(expiresAt('never', null, now)).toBeNull()
    expect(expiresAt('30m', null, now)).toBe('2026-11-14T01:30:00.000Z')
    expect(expiresAt('1h', null, now)).toBe('2026-11-14T02:00:00.000Z')
    expect(expiresAt('today', null, now)).toBe('2026-11-14T14:59:00.000Z')
    expect(expiresAt('1w', null, now)).toBe('2026-11-21T01:00:00.000Z')
  })

  it('「今のまま」は今の消す時刻', () => {
    expect(expiresAt('keep', '2026-11-15T03:00:00Z', now)).toBe('2026-11-15T03:00:00Z')
  })
})
