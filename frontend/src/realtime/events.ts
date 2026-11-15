import type { ConversationSummary, MessageView, ReactionView } from '../api'

// リアルタイムの通知の形（機能定義書 4.3）。OpenAPI では書けないので、機能定義書 4.3 の表を正として手で書く。
// サーバーの形（backend の RealtimeEvent）と同じにする。サーバーが実際に送った JSON の見本（docs/api/realtime-events.json）を
// parseEvent で読めることを events.test.ts で確かめる（基本設計書 2.1）。通知を足すときは、ここと parseEvent を直す

// message.deleted の payload
export type MessageDeleted = { id: number, parentId: number | null }

// reaction.updated の payload。reactions はそのメッセージのリアクション全体（reactedByMe は false で届く。FN-10）
export type ReactionUpdated = { messageId: number, reactions: ReactionView[] }

// conversation.removed の payload。LEFT：抜けた、DELETED：チャンネルが削除された
export type ConversationRemoved = { conversationId: number, reason: 'LEFT' | 'DELETED' }

// workspace.updated の payload（G-3 の印とヘッダーの「@」の件数。FN-14 NT-2・NT-3）
export type WorkspaceUpdated = { workspaceId: number, hasUnread: boolean, mentionCount: number }

// notify の payload（ブラウザの通知の元。FN-14 NT-7）。conversationName はチャンネルなら「#名前」、DM なら「DM」
export type Notify = { kind: 'MENTION' | 'DM', message: MessageView, conversationName: string }

// workspace.removed の payload。KICKED：キックされた、LEFT：退出した、DELETED：ワークスペースが削除された
export type WorkspaceRemoved = { workspaceId: number, name: string, reason: 'KICKED' | 'LEFT' | 'DELETED' }

type Event<Type extends string, Payload> = {
  type: Type
  workspaceId: number
  conversationId: number | null
  payload: Payload
  sentAt: string
}

// payload の MessageView の mine・canDelete・reactions の reactedByMe は false で届くので、受け取った画面で直す（4.3）
export type RealtimeEvent =
  | Event<'message.created', MessageView>
  | Event<'message.updated', MessageView>
  | Event<'message.deleted', MessageDeleted>
  | Event<'reaction.updated', ReactionUpdated>
  // 本人あて（/user/queue/events）
  | Event<'conversation.updated', ConversationSummary>
  | Event<'conversation.removed', ConversationRemoved>
  | Event<'workspace.removed', WorkspaceRemoved>
  | Event<'workspace.updated', WorkspaceUpdated>
  | Event<'notify', Notify>

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const isIdOrNull = (v: unknown) => v === null || isId(v)

const isReaction = (v: unknown): v is ReactionView =>
  isObject(v) && typeof v.emoji === 'string' && typeof v.count === 'number' && Array.isArray(v.users)
  && v.users.every((u) => isObject(u) && typeof u.username === 'string' && typeof u.displayName === 'string')

// 画面が使う項目がそろっているか（全部の項目は確かめない）
function isMessageView(v: unknown): v is MessageView {
  return isObject(v) && isId(v.id) && isId(v.conversationId) && isIdOrNull(v.parentId)
    && isObject(v.author) && typeof v.author.username === 'string' && typeof v.body === 'string'
    && typeof v.createdAt === 'string' && typeof v.deleted === 'boolean'
    && Array.isArray(v.reactions) && v.reactions.every(isReaction)
}

const isMessageDeleted = (v: unknown): v is MessageDeleted => isObject(v) && isId(v.id) && isIdOrNull(v.parentId)

const isReactionUpdated = (v: unknown): v is ReactionUpdated =>
  isObject(v) && isId(v.messageId) && Array.isArray(v.reactions) && v.reactions.every(isReaction)

const isConversationSummary = (v: unknown): v is ConversationSummary =>
  isObject(v) && isId(v.id) && isId(v.workspaceId) && (v.type === 'CHANNEL' || v.type === 'DM')
  && typeof v.joined === 'boolean' && typeof v.general === 'boolean'

const isConversationRemoved = (v: unknown): v is ConversationRemoved =>
  isObject(v) && isId(v.conversationId) && (v.reason === 'LEFT' || v.reason === 'DELETED')

const isWorkspaceRemoved = (v: unknown): v is WorkspaceRemoved =>
  isObject(v) && isId(v.workspaceId) && typeof v.name === 'string'
  && (v.reason === 'KICKED' || v.reason === 'LEFT' || v.reason === 'DELETED')

const isWorkspaceUpdated = (v: unknown): v is WorkspaceUpdated =>
  isObject(v) && isId(v.workspaceId) && typeof v.hasUnread === 'boolean' && typeof v.mentionCount === 'number'

const isNotify = (v: unknown): v is Notify =>
  isObject(v) && (v.kind === 'MENTION' || v.kind === 'DM') && isMessageView(v.message)
  && typeof v.conversationName === 'string'

const payloadCheck: Record<RealtimeEvent['type'], (payload: unknown) => boolean> = {
  'message.created': isMessageView,
  'message.updated': isMessageView,
  'message.deleted': isMessageDeleted,
  'reaction.updated': isReactionUpdated,
  'conversation.updated': isConversationSummary,
  'conversation.removed': isConversationRemoved,
  'workspace.removed': isWorkspaceRemoved,
  'workspace.updated': isWorkspaceUpdated,
  'notify': isNotify,
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
