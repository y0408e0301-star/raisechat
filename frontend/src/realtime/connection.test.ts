import { describe, expect, it, vi } from 'vitest'
import samples from '../../../docs/api/realtime-events.json?raw'
import { Client } from '../test/fakeStomp'
import { conversationTopic, RealtimeConnection, TOKEN_EXPIRED_CLOSE, USER_EVENTS, type ConnectionState } from './connection'

// WebSocket の接続（機能定義書 4.1・4.2・4.4）。@stomp/stompjs は偽物（src/test/fakeStomp.ts）

const created = (JSON.parse(samples) as { type: string }[]).find((e) => e.type === 'message.created')

function setup() {
  const states: ConnectionState[] = []
  const checkSession = vi.fn(async () => {})
  const connection = new RealtimeConnection({ checkSession, url: 'ws://test/ws' })
  connection.subscribeState(() => states.push(connection.getState()))
  connection.start()
  return { connection, client: Client.latest(), states, checkSession }
}

describe('RealtimeConnection', () => {
  it('ハートビート 20 秒、つなぎ直しは 1 秒から倍にして最大 30 秒でつなぐ', () => {
    const { client } = setup()
    expect(client.config).toMatchObject({
      brokerURL: 'ws://test/ws', heartbeatIncoming: 20_000, heartbeatOutgoing: 20_000,
      reconnectDelay: 1_000, maxReconnectDelay: 30_000, reconnectTimeMode: 1,
    })
    expect(client.active).toBe(true)
  })

  it('つないだら本人あてと、頼まれた会話を購読する', async () => {
    const { connection, client, states } = setup()
    connection.subscribeConversation(12, () => {})
    await client.connect()
    expect(client.destinations()).toEqual([USER_EVENTS, conversationTopic(12)])
    expect(states).toEqual(['connecting', 'connected'])
  })

  it('つないだ後に頼まれた会話はすぐ購読し、最後の 1 つをやめたら購読もやめる', async () => {
    const { connection, client } = setup()
    await client.connect()
    const stopA = connection.subscribeConversation(12, () => {})
    const stopB = connection.subscribeConversation(12, () => {})
    expect(client.destinations()).toEqual([USER_EVENTS, conversationTopic(12)])
    stopA()
    expect(client.destinations()).toContain(conversationTopic(12))
    stopB()
    expect(client.destinations()).toEqual([USER_EVENTS])
  })

  it('届いた通知を読んで渡す。読めないものは渡さない', async () => {
    const { connection, client } = setup()
    const handler = vi.fn()
    connection.subscribeConversation(1, handler)
    await client.connect()
    client.deliver(conversationTopic(1), created)
    client.deliver(conversationTopic(1), '{壊れた JSON')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toMatchObject({ type: 'message.created', conversationId: 1 })
  })

  it('切れたら lost にし、つなぎ直す前にログインを確かめ、購読し直して取り直しを頼む', async () => {
    const { connection, client, states, checkSession } = setup()
    const reconnected = vi.fn()
    connection.onReconnect(reconnected)
    connection.subscribeConversation(12, () => {})
    await client.connect()
    expect(checkSession).not.toHaveBeenCalled()
    expect(reconnected).not.toHaveBeenCalled()

    client.drop()
    expect(states.at(-1)).toBe('lost')
    expect(client.destinations()).toEqual([])

    await client.connect()
    expect(checkSession).toHaveBeenCalledTimes(1)
    expect(client.destinations()).toEqual([USER_EVENTS, conversationTopic(12)])
    expect(states.at(-1)).toBe('connected')
    expect(reconnected).toHaveBeenCalledTimes(1)
  })

  it('JWT の期限で切れたときは lost にしない（M-37 を出さない）', async () => {
    const { client, states, checkSession } = setup()
    await client.connect()
    client.drop(TOKEN_EXPIRED_CLOSE)
    expect(states.at(-1)).toBe('connecting')
    await client.connect()
    expect(checkSession).toHaveBeenCalledTimes(1)
  })

  it('ログインの確かめに失敗しても、つなぎ直しは試す', async () => {
    const { client, checkSession, states } = setup()
    await client.connect()
    client.drop()
    checkSession.mockRejectedValueOnce(new Error('通信できない'))
    await client.connect()
    expect(states.at(-1)).toBe('connected')
  })

  it('止めたら切り、lost にしない。購読を頼まれた会話は、次につないだときに購読する', async () => {
    const { connection, client, states } = setup()
    connection.subscribeConversation(12, () => {})
    await client.connect()
    connection.stop()
    expect(client.active).toBe(false)
    expect(states.at(-1)).toBe('idle')

    connection.start()
    const next = Client.latest()
    expect(next).not.toBe(client)
    await next.connect()
    expect(next.destinations()).toEqual([USER_EVENTS, conversationTopic(12)])
  })

  it('止めた後、前の接続が切れても状態を変えない', async () => {
    const { connection, client, states } = setup()
    await client.connect()
    connection.stop()
    client.drop()
    expect(states.at(-1)).toBe('idle')
  })
})
