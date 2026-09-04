import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createWS, createPubSub, type WSSocket } from '~/index'

type Events = {
  'order.created': { orderId: string }
  'order.updated': { orderId: string }
}

const wait = async (delay: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, delay))

class FakeSocket implements WSSocket {
  readyState = 0
  sent: string[] = []
  private listeners = new Map<string, EventListener[]>()

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
    this.dispatch('close')
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

describe('websocket bridge', () => {
  it('dispatches allowed inbound envelopes and forwards allowed outbound envelopes', () => {
    const bus = createPubSub<Events>()
    const socket = new FakeSocket()
    const received: string[] = []
    bus.on('order.created', ({ parsed }) => received.push(parsed.orderId))
    const ws = createWS({
      bus,
      createSocket: () => socket,
      inboundTopics: ['order.created'],
      outboundTopics: ['order.updated'],
      origin: 'ui',
      retry: { jitter: false },
    })

    ws.start()
    socket.open()
    socket.message(
      JSON.stringify({
        id: 'remote-1',
        topic: 'order.created',
        occurredAt: 1,
        origin: 'api',
        parsed: { orderId: 'created-1' },
        serialized: '{"orderId":"created-1"}',
      })
    )
    const outbound = bus.emit('order.updated', { orderId: 'updated-1' }, { origin: 'worker' })

    assert.deepEqual(received, ['created-1'])
    assert.deepEqual(socket.sent, [JSON.stringify(outbound)])
    ws.stop()
  })

  it('retries a failed connection and exposes its status', async () => {
    const bus = createPubSub<Events>()
    const socket = new FakeSocket()
    let attempts = 0
    const ws = createWS({
      bus,
      createSocket: () => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('offline')
        }
        return socket
      },
      retry: { initialDelay: 1, maxDelay: 1, jitter: false },
    })

    ws.start()
    assert.equal(ws.status(), 'retrying')
    await wait(10)
    assert.equal(attempts, 2)
    assert.equal(ws.status(), 'connecting')

    socket.open()
    assert.equal(ws.status(), 'connected')
    ws.stop()
  })

  it('stops retrying after the configured maximum', () => {
    const bus = createPubSub<Events>()
    const ws = createWS({
      bus,
      createSocket: () => {
        throw new Error('offline')
      },
      retry: { maxAttempts: 0, jitter: false },
    })

    ws.start()

    assert.equal(ws.status(), 'stopped')
  })

  it('accepts inbound envelopes matching a wildcard topic', () => {
    const bus = createPubSub<Events>()
    const socket = new FakeSocket()
    const received: string[] = []
    bus.on('order.*', ({ parsed }) => received.push((parsed as { orderId: string }).orderId))
    const ws = createWS({
      bus,
      createSocket: () => socket,
      inboundTopics: ['order.*'],
      origin: 'ui',
      retry: { jitter: false },
    })

    ws.start()
    socket.open()
    socket.message(
      JSON.stringify({
        id: 'remote-1',
        topic: 'order.updated',
        occurredAt: 1,
        origin: 'api',
        parsed: { orderId: 'updated-1' },
        serialized: '{"orderId":"updated-1"}',
      })
    )

    assert.deepEqual(received, ['updated-1'])
    ws.stop()
  })
})
