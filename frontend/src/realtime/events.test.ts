import { describe, expect, it } from 'vitest'
// サーバーが実際に送った通知の JSON（backend の WebSocketApiTests が書き出す）
import samples from '../../../docs/api/realtime-events.json?raw'
import { parseEvent } from './events'

// 通知の型（機能定義書 4.3、基本設計書 2.1）

describe('parseEvent', () => {
  const events = JSON.parse(samples) as unknown[]

  it('サーバーが送った通知の見本を、すべて読める', () => {
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      const parsed = parseEvent(JSON.stringify(event))
      expect(parsed, JSON.stringify(event)).not.toBeNull()
      expect(parsed?.type).toBe((event as { type: string }).type)
    }
  })

  it('画面で使う通知の種類（機能定義書 4.3）が、見本にそろっている', () => {
    const types = events.map((e) => (e as { type: string }).type)
    expect(types).toEqual(expect.arrayContaining([
      'message.created', 'message.updated', 'message.deleted', 'reaction.updated', 'conversation.updated',
      'conversation.removed',
    ]))
  })

  it('JSON でない・知らない種類・形の違うものは読まない', () => {
    const created = events.find((e) => (e as { type: string }).type === 'message.created') as Record<string, unknown>
    expect(parseEvent('{')).toBeNull()
    expect(parseEvent('[]')).toBeNull()
    expect(parseEvent(JSON.stringify({ ...created, type: 'unknown.type' }))).toBeNull()
    expect(parseEvent(JSON.stringify({ ...created, workspaceId: '1' }))).toBeNull()
    expect(parseEvent(JSON.stringify({ ...created, payload: { id: 1, parentId: null } }))).toBeNull()
  })
})
