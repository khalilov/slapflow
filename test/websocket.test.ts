import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'vitest'
import { createWebSocket, createPubSub } from '~/index'

type Events = {
  message: unknown
  open: unknown
  close: unknown
  error: unknown
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  url = ''
  private listeners = new Map<string, EventListener[]>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener): void {
    const items = this.listeners.get(type) ?? []
    items.push(listener)
    this.listeners.set(type, items)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== listener)
    )
  }

  close(): void {
    this.readyState = 3
    this.dispatch('close', { code: 1000, reason: '' })
  }

  open(): void {
    this.readyState = 1
    this.dispatch('open')
  }

  message(data: string): void {
    this.dispatch('message', { data })
  }

  private dispatch(type: string, extra: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, ...extra } as Event)
    }
  }
}

describe('createWebSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    Object.assign(globalThis, { WebSocket: FakeWebSocket })
  })

  afterEach(() => {
    Object.assign(globalThis, { WebSocket: undefined })
  })

  it('proxies native socket messages into the bus as raw events', () => {
    const bus = createPubSub<Events>()
    const received: unknown[] = []
    bus.on('message', ({ parsed }) => received.push(parsed))
    bus.on('open', ({ parsed }) => received.push(`open:${(parsed as { url: string }).url}`))

    const ws = createWebSocket<Events>({ url: 'ws://gateway', bus, reconnect: { jitter: false } })

    ws.start()
    assert.equal(ws.status(), 'connecting')

    const socket = FakeWebSocket.instances[0]
    socket!.open()
    assert.equal(ws.status(), 'connected')

    socket!.message(JSON.stringify({ type: 'colony:state', payload: { ok: true } }))

    assert.deepEqual(received, ['open:ws://gateway', { type: 'colony:state', payload: { ok: true } }])
    ws.stop()
  })

  it('reconnects after the socket closes', async () => {
    const bus = createPubSub<Events>()
    const ws = createWebSocket<Events>({
      url: 'ws://gateway',
      bus,
      reconnect: { initialDelay: 1, maxDelay: 1, jitter: false },
    })

    ws.start()
    const first = FakeWebSocket.instances[0]
    first!.open()
    first!.close()

    assert.equal(ws.status(), 'reconnecting')
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(FakeWebSocket.instances.length, 2)
    assert.equal(ws.status(), 'connecting')
    ws.stop()
  })
})
