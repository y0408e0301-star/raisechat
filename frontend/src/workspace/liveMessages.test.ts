import { describe, expect, it } from 'vitest'
import type { MessageView } from '../api'
import type { RealtimeEvent } from '../realtime/events'
import { me } from '../test/render'
import { addMessage, applyEvent, forViewer, settlePending, type Viewer } from './liveMessages'

// 通知をメッセージの一覧に当てはめる（機能定義書 4.3、FN-07 5 章の 7）

const hanako = { username: 'hanako', displayName: 'はなこ', avatarUrl: null, statusEmoji: null, statusText: null }

const message = (id: number, extra: Partial<MessageView> = {}): MessageView => ({
  id, conversationId: 10, parentId: null, author: hanako, body: `本文${id}`, attachments: [], reactions: [], replyCount: 0, lastReplyAt: null, replyUsers: [],
  createdAt: '2026-11-11T01:00:00Z', editedAt: null, deleted: false, mine: false, canDelete: false, ...extra,
})

const viewer: Viewer = { me, owner: false }

const created = (payload: MessageView): RealtimeEvent =>
  ({ type: 'message.created', workspaceId: 3, conversationId: 10, payload, sentAt: '2026-11-11T01:00:00Z' })

describe('forViewer', () => {
  it('自分のものは mine にして消せる。ほかの人のものはオーナーだけ消せる。「削除されました」は誰も消せない', () => {
    expect(forViewer(message(1, { author: me }), viewer)).toMatchObject({ mine: true, canDelete: true })
    expect(forViewer(message(1), viewer)).toMatchObject({ mine: false, canDelete: false })
    expect(forViewer(message(1), { me, owner: true })).toMatchObject({ mine: false, canDelete: true })
    expect(forViewer(message(1, { author: me, deleted: true }), viewer)).toMatchObject({ canDelete: false })
  })
})

describe('addMessage', () => {
  it('ID の順に並べ、同じ ID は足さない', () => {
    const items = [message(1), message(3)]
    expect(addMessage(items, message(4)).map((m) => m.id)).toEqual([1, 3, 4])
    expect(addMessage(items, message(2)).map((m) => m.id)).toEqual([1, 2, 3])
    expect(addMessage(items, message(3))).toBe(items)
  })
})

describe('applyEvent', () => {
  it('更新はあるものだけ置き換え、削除は一覧から消す', () => {
    const items = [message(1), message(2)]
    const updated = applyEvent(items,
      { type: 'message.updated', workspaceId: 3, conversationId: 10, payload: message(2, { body: '直した' }), sentAt: '' },
      viewer)
    expect(updated.map((m) => m.body)).toEqual(['本文1', '直した'])
    const deleted = applyEvent(items,
      { type: 'message.deleted', workspaceId: 3, conversationId: 10, payload: { id: 1, parentId: null }, sentAt: '' },
      viewer)
    expect(deleted.map((m) => m.id)).toEqual([2])
  })
})

const pending = (clientId: string, body: string, failed = false) =>
  ({ kind: 'pending' as const, clientId, author: me, body, attachments: [], createdAt: '2026-11-11T01:00:00Z', failed })

describe('settlePending', () => {
  it('自分の送信の通知は、同じ本文の「送信中」を 1 つ消す（改行と前後の空白はサーバーと同じにそろえて比べる）', () => {
    const list = [pending('a', ' 1 行目\r\n2 行目 '), pending('b', ' 1 行目\r\n2 行目 ')]
    const settled = settlePending(list, created(message(5, { author: me, body: '1 行目\n2 行目' })), viewer)
    expect(settled.map((p) => p.clientId)).toEqual(['b'])
  })

  it('ほかの人の通知・送れなかったものは消さない', () => {
    const list = [pending('a', '本文5', true)]
    expect(settlePending(list, created(message(5)), viewer)).toBe(list)
    expect(settlePending(list, created(message(5, { author: me })), viewer)).toBe(list)
  })
})
