import { Client, ReconnectionTimeMode, type IMessage, type StompSubscription } from '@stomp/stompjs'
import { parseEvent, type RealtimeEvent } from './events'

// WebSocket（STOMP）の接続（機能定義書 4.1・4.2・4.4）。
// ・ログインしている間つなぎ続け、20 秒ごとにハートビートを送り合う
// ・切れたら 1 秒・2 秒・4 秒…（最大 30 秒）と間を空けてつなぎ直す。つなぎ直す前に、ログインが続いているかを確かめる
//   （JWT の期限が切れていれば取り直す。サーバーは JWT の期限が来たら 4001 で切る）
// ・購読は、本人あて（/user/queue/events）と、画面が頼んだ会話（/topic/conversations/{id}）だけ。つなぎ直したら購読し直す

// 接続の状態。lost のときに M-37 を出す。JWT の期限で切れたとき（つなぎ直している間も）は connecting にして出さない。
// idle はつないでいない（ログインしていない）
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'lost'

export type EventHandler = (event: RealtimeEvent) => void

// サーバーが JWT の期限で切るときの番号（backend の WebSocketSessions.TOKEN_EXPIRED）
export const TOKEN_EXPIRED_CLOSE = 4001

const HEARTBEAT_MS = 20_000
const FIRST_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 30_000

export const USER_EVENTS = '/user/queue/events'
export const conversationTopic = (conversationId: number) => `/topic/conversations/${conversationId}`

// 画面と同じ場所の /ws（開発中は Vite が 8080 へ転送する）。公開先の HTTPS では wss
function defaultUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/ws`
}

type Topic = { handlers: Set<EventHandler>, subscription: StompSubscription | null }

export type ConnectionOptions = {
  // つなぎ直す前に呼ぶ。ログインが続いているかを確かめ、JWT を取り直す（取り直せなければ M-8 を出して G-1 に移す）
  checkSession: () => Promise<void>
  url?: string
}

// 購読を頼まれた会話・つなぎ直しを待つ画面は、つないでいない間（start の前・stop の後）も覚えておき、次につないだときに使う
export class RealtimeConnection {
  private readonly options: ConnectionOptions
  private readonly topics = new Map<number, Topic>()
  private readonly userHandlers = new Set<EventHandler>()
  private readonly reconnectListeners = new Set<() => void>()
  private readonly stateListeners = new Set<() => void>()
  private client: Client | null = null
  private state: ConnectionState = 'idle'
  private connectedOnce = false
  // 前の接続が切れた・つなげなかったか（次につなぐ前にログインを確かめる）
  private dropped = false

  constructor(options: ConnectionOptions) {
    this.options = options
  }

  // ログインしたとき。つなぎ始める
  start(): void {
    if (this.client) return
    const client = new Client({
      brokerURL: this.options.url ?? defaultUrl(),
      heartbeatIncoming: HEARTBEAT_MS,
      heartbeatOutgoing: HEARTBEAT_MS,
      reconnectDelay: FIRST_RECONNECT_MS,
      reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
      maxReconnectDelay: MAX_RECONNECT_MS,
      beforeConnect: () => this.beforeConnect(),
      onConnect: () => this.connected(client),
      onWebSocketClose: (event: CloseEvent) => this.closed(client, event),
    })
    this.client = client
    this.connectedOnce = false
    this.dropped = false
    this.setState('connecting')
    client.activate()
  }

  // ログアウトしたとき・画面を閉じるとき。切って、つなぎ直さない
  stop(): void {
    const client = this.client
    if (!client) return
    this.client = null
    for (const topic of this.topics.values()) topic.subscription = null
    this.setState('idle')
    void client.deactivate()
  }

  getState = (): ConnectionState => this.state

  // 状態が変わったら listener を呼ぶ（useSyncExternalStore で読む）
  subscribeState = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  // 会話の通知を受け取る。返した関数で受け取るのをやめ、最後の 1 つなら購読もやめる（4.2）
  subscribeConversation = (conversationId: number, handler: EventHandler): (() => void) => {
    let topic = this.topics.get(conversationId)
    if (!topic) {
      topic = { handlers: new Set(), subscription: null }
      this.topics.set(conversationId, topic)
      if (this.client?.connected) {
        topic.subscription = this.subscribe(this.client, conversationTopic(conversationId), topic.handlers)
      }
    }
    topic.handlers.add(handler)
    return () => {
      const current = this.topics.get(conversationId)
      if (!current) return
      current.handlers.delete(handler)
      if (current.handlers.size > 0) return
      this.topics.delete(conversationId)
      if (current.subscription && this.client?.connected) current.subscription.unsubscribe()
    }
  }

  // 本人あての通知を受け取る
  subscribeUser = (handler: EventHandler): (() => void) => {
    this.userHandlers.add(handler)
    return () => this.userHandlers.delete(handler)
  }

  // つなぎ直せたときに呼ぶ（初めてつないだときは呼ばない）。画面は届かなかった分を API で取り直す（4.4）
  onReconnect = (listener: () => void): (() => void) => {
    this.reconnectListeners.add(listener)
    return () => this.reconnectListeners.delete(listener)
  }

  private async beforeConnect(): Promise<void> {
    if (!this.dropped) return
    try {
      await this.options.checkSession()
    } catch {
      // インターネットにつながらないなど。そのままつなぎ直しを試し、失敗したらまた間を空ける
    }
  }

  private connected(client: Client): void {
    if (client !== this.client) return
    this.dropped = false
    this.subscribe(client, USER_EVENTS, this.userHandlers)
    for (const [conversationId, topic] of this.topics) {
      topic.subscription = this.subscribe(client, conversationTopic(conversationId), topic.handlers)
    }
    this.setState('connected')
    if (this.connectedOnce) this.reconnectListeners.forEach((listener) => listener())
    this.connectedOnce = true
  }

  // 止めた後（ログアウト）の切断は何もしない
  private closed(client: Client, event: CloseEvent): void {
    if (client !== this.client) return
    this.dropped = true
    for (const topic of this.topics.values()) topic.subscription = null
    this.setState(event.code === TOKEN_EXPIRED_CLOSE ? 'connecting' : 'lost')
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    this.stateListeners.forEach((listener) => listener())
  }

  private subscribe(client: Client, destination: string, handlers: Set<EventHandler>): StompSubscription {
    return client.subscribe(destination, (message: IMessage) => {
      const event = parseEvent(message.body)
      if (event) handlers.forEach((handler) => handler(event))
    })
  }
}
