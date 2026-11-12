// テストで @stomp/stompjs の代わりに使う偽物（src/test/setup.ts で差し替える）。
// 本物の WebSocket にはつながず、テストから「つながった」「切れた」「通知が届いた」を起こせる

export const ReconnectionTimeMode = { LINEAR: 0, EXPONENTIAL: 1 } as const

type Config = {
  brokerURL?: string
  heartbeatIncoming?: number
  heartbeatOutgoing?: number
  reconnectDelay?: number
  reconnectTimeMode?: number
  maxReconnectDelay?: number
  beforeConnect?: () => void | Promise<void>
  onConnect?: () => void
  onWebSocketClose?: (event: CloseEvent) => void
}

type Subscription = { id: number, destination: string, callback: (message: { body: string }) => void, active: boolean }

export class Client {
  // 作られた偽物（新しい順ではなく作った順）
  static readonly instances: Client[] = []

  readonly config: Config
  connected = false
  active = false
  readonly subscriptions: Subscription[] = []
  private nextId = 1

  constructor(config: Config) {
    this.config = config
    Client.instances.push(this)
  }

  activate(): void {
    this.active = true
  }

  async deactivate(): Promise<void> {
    this.active = false
    if (this.connected) this.drop(1000)
  }

  subscribe(destination: string, callback: Subscription['callback']) {
    if (!this.connected) throw new Error('つながっていないのに購読した')
    const subscription: Subscription = { id: this.nextId++, destination, callback, active: true }
    this.subscriptions.push(subscription)
    return { id: String(subscription.id), unsubscribe: () => { subscription.active = false } }
  }

  // ---------------------------------------------------------------- テストから使う

  // つなぐ（つなぎ直す）。本物と同じく、つなぐ前に beforeConnect を待つ
  async connect(): Promise<void> {
    await this.config.beforeConnect?.()
    this.connected = true
    this.config.onConnect?.()
  }

  // 切れる。code はサーバーが付けた番号（4001 は JWT の期限）
  drop(code = 1006): void {
    this.connected = false
    for (const s of this.subscriptions) s.active = false
    this.config.onWebSocketClose?.(new CloseEvent('close', { code }))
  }

  // いま購読している宛先
  destinations(): string[] {
    return this.subscriptions.filter((s) => s.active).map((s) => s.destination)
  }

  // 宛先に通知を届ける
  deliver(destination: string, body: unknown): void {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    for (const s of this.subscriptions) if (s.active && s.destination === destination) s.callback({ body: text })
  }

  static latest(): Client {
    const client = Client.instances.at(-1)
    if (!client) throw new Error('STOMP のクライアントが作られていない')
    return client
  }

  static reset(): void {
    Client.instances.length = 0
  }
}
