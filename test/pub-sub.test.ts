import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createPubSub, PubSub, type Bus } from '~/index'

type AppEvents = {
  'auth.signed-in': { userId: string }
  'order.created': { orderId: string }
}

describe('pub/sub', () => {
  it('emits typed payloads to subscribers in registration order', () => {
    const bus: Bus<AppEvents> = createPubSub<AppEvents>()
    const received: string[] = []

    bus.on('order.created', ({ parsed }) => received.push(`first:${parsed.orderId}`))
    bus.on('order.created', ({ parsed }) => received.push(`second:${parsed.orderId}`))
    bus.emit('order.created', { orderId: 'order-1' })

    assert.deepEqual(received, ['first:order-1', 'second:order-1'])
  })

  it('unsubscribes a handler through the function returned by on', () => {
    const bus = createPubSub<AppEvents>()
    const received: string[] = []
    const unsubscribe = bus.on('auth.signed-in', ({ parsed }) => received.push(parsed.userId))

    bus.emit('auth.signed-in', { userId: 'ada' })
    unsubscribe()
    bus.emit('auth.signed-in', { userId: 'grace' })

    assert.deepEqual(received, ['ada'])
  })

  it('removes one handler or every handler for an event', () => {
    const bus = createPubSub<AppEvents>()
    const received: string[] = []
    const first = ({ parsed }: { parsed: AppEvents['auth.signed-in'] }) => received.push(`first:${parsed.userId}`)
    const second = ({ parsed }: { parsed: AppEvents['auth.signed-in'] }) => received.push(`second:${parsed.userId}`)

    bus.on('auth.signed-in', first)
    bus.on('auth.signed-in', second)
    bus.off('auth.signed-in', first)
    bus.emit('auth.signed-in', { userId: 'ada' })
    bus.off('auth.signed-in')
    bus.emit('auth.signed-in', { userId: 'grace' })

    assert.deepEqual(received, ['second:ada'])
  })

  it('isolates subscriber errors and reports them without skipping remaining handlers', () => {
    const errors: string[] = []
    const received: string[] = []
    const bus = createPubSub<AppEvents>({
      onError: (event) => {
        if (event.type === 'subscriber') {
          errors.push(`${event.event.topic}:${String(event.error)}`)
        }
      },
    })

    bus.on('order.created', () => {
      throw new Error('subscriber failed')
    })
    bus.on('order.created', ({ parsed }) => received.push(parsed.orderId))
    bus.emit('order.created', { orderId: 'order-1' })

    assert.deepEqual(errors, ['order.created:Error: subscriber failed'])
    assert.deepEqual(received, ['order-1'])
  })

  it('exports a shared default bus', () => {
    const received: string[] = []
    const unsubscribe = PubSub.on('test.pub-sub.singleton', ({ parsed }) => received.push(String(parsed)))

    PubSub.emit('test.pub-sub.singleton', 'ready')
    unsubscribe()

    assert.deepEqual(received, ['ready'])
  })

  it('creates one event envelope with origin and serialized payload', () => {
    const bus = createPubSub<AppEvents>()
    const event = bus.emit('order.created', { orderId: 'order-1' }, { origin: 'worker' })

    assert.equal(event.id.length > 0, true)
    assert.equal(event.topic, 'order.created')
    assert.equal(event.origin, 'worker')
    assert.equal(event.occurredAt <= Date.now(), true)
    assert.deepEqual(event.parsed, { orderId: 'order-1' })
    assert.equal(event.serialized, '{"orderId":"order-1"}')
  })

  it('publishes an error payload when serialization fails', () => {
    const errors: unknown[] = []
    const received: unknown[] = []
    const bus = createPubSub<Record<string, unknown>>({
      onError: (event) => {
        if (event.type === 'serialization') {
          errors.push(event.error)
        }
      },
    })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    bus.on('broken', ({ parsed }) => received.push(parsed))

    const event = bus.emit('broken', circular)

    assert.equal(errors.length, 1)
    assert.deepEqual(event.parsed, received[0])
    assert.equal(typeof event.serialized, 'string')
    assert.equal('error' in (event.parsed as Record<string, unknown>), true)
  })

  it('reports the original serialization cause once before delivering the error body', () => {
    const cause = new Error('toJSON failed')
    const order: string[] = []
    const errors: unknown[] = []
    const bus = createPubSub<Record<string, unknown>>({
      onError: ({ type, error }) => {
        if (type === 'serialization') {
          errors.push(error)
          order.push('error')
        }
      },
    })
    const payload = {
      toJSON: () => {
        throw cause
      },
    }

    bus.on('broken', ({ parsed, serialized }) => {
      order.push('subscriber')
      assert.deepEqual(parsed, { error: 'toJSON failed' })
      assert.equal(serialized, '{"error":"toJSON failed"}')
    })
    bus.emit('broken', payload)
    assert.deepEqual(order, ['error', 'subscriber'])
    assert.deepEqual(errors, [cause])
  })

  it('serializes successful payloads once and preserves scalar JSON results', () => {
    let calls = 0
    const bus = createPubSub<Record<string, unknown>>()
    const payload = {
      toJSON: () => {
        calls += 1
        return { calls }
      },
    }
    const event = bus.emit('value', payload)

    assert.equal(calls, 1)
    assert.equal(event.parsed, payload)
    assert.equal(event.serialized, '{"calls":1}')
    assert.equal(bus.emit('value', false).serialized, 'false')
    assert.equal(bus.emit('value', 0).serialized, '0')
    assert.equal(bus.emit('value', null).serialized, 'null')
    assert.equal(bus.emit('value', '').serialized, '""')
  })

  it('keeps non-serializable root values on the existing error-envelope path', () => {
    const errors: unknown[] = []
    const bus = createPubSub<Record<string, unknown>>({
      onError: ({ type, error }) => {
        if (type === 'serialization') {
          errors.push(error)
        }
      },
    })
    const values = [undefined, () => undefined, Symbol('value'), 1n]

    for (const value of values) {
      const event = bus.emit('broken', value)

      assert.ok(event.parsed !== null && typeof event.parsed === 'object' && 'error' in event.parsed)
      assert.equal(typeof event.parsed.error, 'string')
      assert.equal(event.serialized, JSON.stringify(event.parsed))
    }
    assert.equal(errors.length, values.length)
  })

  it('dispatches a validated external event without changing its envelope', () => {
    const bus = createPubSub<AppEvents>()
    const received: unknown[] = []
    const event = {
      id: 'remote-1',
      topic: 'order.created',
      occurredAt: 1,
      origin: 'api',
      parsed: { orderId: 'order-1' },
      serialized: '{"orderId":"order-1"}',
    }
    bus.on('order.created', (item) => received.push(item))

    const dispatched = bus.dispatch(event)

    assert.equal(dispatched, event)
    assert.deepEqual(received, [event])
  })

  it('treats a bare * as a catch-all for every topic', () => {
    type HubEvents = {
      'editor.command': { name: string }
      'user.created': { id: string }
      'a.b.c': { id: string }
    }
    const bus = createPubSub<HubEvents>()
    const received: string[] = []

    bus.on('*', (e) => received.push(e.topic))

    bus.emit('editor.command', { name: 'x' })
    bus.emit('user.created', { id: 'a' })
    bus.emit('a.b.c', { id: 'b' })

    assert.deepEqual(received, ['editor.command', 'user.created', 'a.b.c'])
  })

  it('matches wildcard subscriptions segment by segment', () => {
    type HubEvents = {
      'hub.user.created': { id: string }
      'hub.user.deleted': { id: string }
      'hub.team.created': { id: string }
      'hub.user.audit.export': { id: string }
    }
    const bus = createPubSub<HubEvents>()
    const received: string[] = []

    bus.on('hub.user.*', ({ parsed }) => received.push(`user:${(parsed as { id: string }).id}`))
    bus.on('hub.*.created', ({ parsed }) => received.push(`created:${(parsed as { id: string }).id}`))

    bus.emit('hub.user.created', { id: 'a' })
    bus.emit('hub.user.deleted', { id: 'b' })
    bus.emit('hub.team.created', { id: 'c' })
    bus.emit('hub.user.audit.export', { id: 'd' })

    assert.deepEqual(received, ['user:a', 'created:a', 'user:b', 'created:c'])
  })

  it('does not let a wildcard segment cross a dot boundary', () => {
    type HubEvents = {
      'hub.user.created': { id: string }
      'hub.user.audit.export': { id: string }
    }
    const bus = createPubSub<HubEvents>()
    const received: string[] = []

    bus.on('hub.*.export', ({ parsed }) => received.push((parsed as { id: string }).id))
    bus.emit('hub.user.audit.export', { id: 'a' })
    bus.emit('hub.user.created', { id: 'b' })

    assert.deepEqual(received, [])
  })

  it('unsubscribes a wildcard subscription', () => {
    type HubEvents = { 'hub.user.created': { id: string } }
    const bus = createPubSub<HubEvents>()
    const received: string[] = []
    const unsubscribe = bus.on('hub.user.*', ({ parsed }) => received.push((parsed as { id: string }).id))

    bus.emit('hub.user.created', { id: 'a' })
    unsubscribe()
    bus.emit('hub.user.created', { id: 'b' })

    assert.deepEqual(received, ['a'])
  })
})
