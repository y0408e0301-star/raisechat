import type { MessageView } from '../api'

// リアルタイムの通知の形（機能定義書 4.3）。OpenAPI では書けないので、機能定義書 4.3 の表を正として手で書く。
// サーバーの形（backend の RealtimeEvent）と同じにする。サーバーが実際に送った JSON の見本（docs/api/realtime-events.json）を
// parseEvent で読めることを events.test.ts で確かめる（基本設計書 2.1）。通知を足すときは、ここと parseEvent を直す

// message.deleted の payload
export type MessageDeleted = { id: number, parentId: number | null }

type Event<Type extends string, Payload> = {
  type: Type
  workspaceId: number
  conversationId: number | null
  payload: Payload
  sentAt: string
}

// payload の MessageView の mine・canDelete は false で届くので、受け取った画面で直す（4.3）
export type RealtimeEvent =
  | Event<'message.created', MessageView>
  | Event<'message.updated', MessageView>
  | Event<'message.deleted', MessageDeleted>

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const isIdOrNull = (v: unknown) => v === null || isId(v)

// 画面が使う項目がそろっているか（全部の項目は確かめない）
function isMessageView(v: unknown): v is MessageView {
  return isObject(v) && isId(v.id) && isId(v.conversationId) && isIdOrNull(v.parentId)
    && isObject(v.author) && typeof v.author.username === 'string' && typeof v.body === 'string'
    && typeof v.createdAt === 'string' && typeof v.deleted === 'boolean'
}

const isMessageDeleted = (v: unknown): v is MessageDeleted => isObject(v) && isId(v.id) && isIdOrNull(v.parentId)

const payloadCheck: Record<RealtimeEvent['type'], (payload: unknown) => boolean> = {
  'message.created': isMessageView,
  'message.updated': isMessageView,
  'message.deleted': isMessageDeleted,
}

// 届いた本文（JSON の文字列）を読む。形が違う・知らない種類の通知は null（無視する）
export function parseEvent(body: string): RealtimeEvent | null {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return null
  }
  if (!isObject(raw) || typeof raw.type !== 'string' || !Object.hasOwn(payloadCheck, raw.type)) return null
  if (!isId(raw.workspaceId) || !isIdOrNull(raw.conversationId) || typeof raw.sentAt !== 'string') return null
  if (!payloadCheck[raw.type as RealtimeEvent['type']](raw.payload)) return null
  return raw as RealtimeEvent
}
