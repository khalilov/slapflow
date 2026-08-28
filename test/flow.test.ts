import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createFlow, createPubSub, type Bus, type EventMap } from '~/index'

type Context = {
  requestId: string
}

type Events = {
  'form.submit': { email: string; id?: string }
}

const flush = async (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('flow', () => {
  it('runs a configured entrypoint when a bound bus event is emitted', () => {
    const bus = createPubSub<Events>()
    const received: Array<{ context: Context; input: Events['form.submit'] }> = []
    const chain = createFlow<Context, unknown, Events>(
      {
        actions: {
          'form.save': ({ context, input }) => {
            received.push({ context, input: input as Events['form.submit'] })
          },
        },
        events: {
          '[bus] form.submit': { entrypoint: 'form.submit' },
        },
        config: {
          entrypoints: { 'form.submit': 'form.save' },
          strategies: { 'form.save': { fn: 'form.save' } },
        },
      },
      { bus, context: () => ({ requestId: 'request-1' }) }
    )

    const started = chain.start()
    bus.emit('form.submit', { email: 'ada@example.com' })

    assert.deepEqual(started.active, ['[bus] form.submit'])
    assert.deepEqual(started.inactive, [])
    assert.equal(started.validation.ok, true)
    assert.deepEqual(received, [{ context: { requestId: 'request-1' }, input: { email: 'ada@example.com' } }])
  })

  it('drops external bus envelopes with a non-object payload', () => {
    const bus = createPubSub<Events>()
    const diagnostics: string[] = []
    let calls = 0
    const diagnosticBus = bus as Bus<EventMap>
    diagnosticBus.on('slapflow.run.dropped', ({ parsed }) =>
      diagnostics.push(String((parsed as { reason?: unknown }).reason))
    )
    const chain = createFlow<Context, unknown, Events>(
      {
        actions: {
          save: () => {
            calls += 1
          },
        },
        events: { '[bus] form.submit': { entrypoint: 'form.submit' } },
        config: {
          entrypoints: { 'form.submit': 'save' },
          strategies: { save: { fn: 'save' } },
        },
      },
      { bus, context: { requestId: 'request-1' } }
    )

    chain.start()
    diagnosticBus.dispatch({
      id: 'external-1',
      topic: 'form.submit',
      occurredAt: Date.now(),
      parsed: 'invalid',
      serialized: '"invalid"',
    })

    assert.equal(calls, 0)
    assert.deepEqual(diagnostics, ['input-not-object'])
  })

  it('uses fresh context for each bus event and removes bindings when stopped', () => {
    const bus = createPubSub<Events>()
    const requestIds: string[] = []
    let request = 0
    const chain = createFlow<Context, unknown, Events>(
      {
        actions: {
          save: ({ context }) => {
            requestIds.push(context.requestId)
          },
        },
        events: { '[bus] form.submit': { entrypoint: 'form.submit' } },
        config: {
          entrypoints: { 'form.submit': 'save' },
          strategies: { save: { fn: 'save' } },
        },
      },
      {
        bus,
        context: () => ({ requestId: `request-${++request}` }),
      }
    )

    chain.start()
    bus.emit('form.submit', { email: 'ada@example.com' })
    bus.emit('form.submit', { email: 'grace@example.com' })
    chain.stop()
    bus.emit('form.submit', { email: 'lin@example.com' })

    assert.deepEqual(requestIds, ['request-1', 'request-2'])
  })

  it('replaces bindings when started again', () => {
    const bus = createPubSub<Events>()
    let calls = 0
    const chain = createFlow<Context, unknown, Events>(
      {
        actions: {
          save: () => {
            calls += 1
          },
        },
        events: { '[bus] form.submit': { entrypoint: 'form.submit' } },
        config: {
          entrypoints: { 'form.submit': 'save' },
          strategies: { save: { fn: 'save' } },
        },
      },
      { bus, context: { requestId: 'request-1' } }
    )

    chain.start()
    chain.start()
    bus.emit('form.submit', { email: 'ada@example.com' })

    assert.equal(calls, 1)
  })

  it('does not activate bindings when config validation fails', () => {
    const bus = createPubSub<Events>()
    const chain = createFlow<Context, unknown, Events>(
      {
        events: { '[bus] form.submit': { entrypoint: 'form.submit' } },
        config: {
          entrypoints: { 'form.submit': 'missing' },
          strategies: {},
        },
      },
      { bus, context: { requestId: 'request-1' } }
    )

    const started = chain.start()

    assert.equal(started.validation.ok, false)
    assert.deepEqual(started.active, [])
  })

  it('reports only final failed runner results through onRunnerError', async () => {
    const bus = createPubSub<Events>()
    const errors: Array<{ binding: string; entrypoint: string; code: string }> = []
    const chain = createFlow<Context, unknown, Events>(
      {
        actions: {
          fail: () => ({ type: 'fail' as const, reason: 'blocked' }),
        },
        events: { '[bus] form.submit': { entrypoint: 'form.submit' } },
        config: {
          entrypoints: { 'form.submit': 'fail' },
          strategies: { fail: { fn: 'fail' } },
        },
      },
      {
        bus,
        context: { requestId: 'request-1' },
        onRunnerError: ({ binding, entrypoint, error }) => errors.push({ binding, entrypoint, code: error.code }),
      }
    )

    chain.start()
    bus.emit('form.submit', { email: 'ada@example.com' })
    await flush()

    assert.deepEqual(errors, [{ binding: '[bus] form.submit', entrypoint: 'form.submit', code: 'ACTION_THROWN' }])
  })

  it('cancels only the active run in the same latest lane', () => {
    const bus = createPubSub<Events>()
    const calls: Array<{ id: string | undefined; signal: AbortSignal }> = []
    const chain = createFlow<Context, unknown, Events>(
      {
        actions: {
          save: ({ input, signal }) => {
            calls.push({ id: input.id as string | undefined, signal })
            return new Promise<void>(() => undefined)
          },
        },
        events: {
          '[bus] form.submit': {
            entrypoint: 'form.submit',
            options: { concurrency: { mode: 'latest', key: ({ id }) => id ?? '' } },
          },
        },
        config: {
          entrypoints: { 'form.submit': 'save' },
          strategies: { save: { fn: 'save' } },
        },
      },
      { bus, context: { requestId: 'request-1' } }
    )

    chain.start()
    bus.emit('form.submit', { email: 'ada@example.com', id: 'first' })
    bus.emit('form.submit', { email: 'grace@example.com', id: 'second' })
    bus.emit('form.submit', { email: 'lin@example.com', id: 'first' })

    assert.deepEqual(
      calls.map((call) => call.id),
      ['first', 'second', 'first']
    )
    assert.equal(calls[0]?.signal.aborted, true)
    assert.equal(calls[1]?.signal.aborted, false)
    assert.equal(calls[2]?.signal.aborted, false)

    chain.stop({ force: true })
  })

  it('queues runs in order and reports queue overflow', async () => {
    const bus = createPubSub<Events>()
    const diagnostics: string[] = []
    const diagnosticBus = bus as Bus<EventMap>
    diagnosticBus.on('slapflow.queue.overflow', () => diagnostics.push('overflow'))
    diagnosticBus.on('slapflow.run.dropped', () => diagnostics.push('dropped'))

    const calls: string[] = []
    const resolvers: Array<() => void> = []
    const chain = createFlow<Context, unknown, Events>(
      {
        actions: {
          save: ({ input }) => {
            calls.push(input.email as string)
            return new Promise<void>((resolve) => resolvers.push(resolve))
          },
        },
        events: {
          '[bus] form.submit': {
            entrypoint: 'form.submit',
            options: { concurrency: { mode: 'queue', maxQueueSize: 1, overflow: 'drop-newest' } },
          },
        },
        config: {
          entrypoints: { 'form.submit': 'save' },
          strategies: { save: { fn: 'save' } },
        },
      },
      { bus, context: { requestId: 'request-1' } }
    )

    chain.start()
    bus.emit('form.submit', { email: 'first@example.com' })
    bus.emit('form.submit', { email: 'second@example.com' })
    bus.emit('form.submit', { email: 'third@example.com' })
    resolvers.shift()?.()
    await flush()

    assert.deepEqual(calls, ['first@example.com', 'second@example.com'])
    assert.deepEqual(diagnostics, ['overflow', 'dropped'])

    chain.stop({ force: true })
  })

  it('drops events while a drop lane is active and force-aborts active runs', () => {
    const bus = createPubSub<Events>()
    const calls: AbortSignal[] = []
    const chain = createFlow<Context, unknown, Events>(
      {
        actions: {
          save: ({ signal }) => {
            calls.push(signal)
            return new Promise<void>(() => undefined)
          },
        },
        events: {
          '[bus] form.submit': {
            entrypoint: 'form.submit',
            options: { concurrency: { mode: 'drop' } },
          },
        },
        config: {
          entrypoints: { 'form.submit': 'save' },
          strategies: { save: { fn: 'save' } },
        },
      },
      { bus, context: { requestId: 'request-1' } }
    )

    chain.start()
    bus.emit('form.submit', { email: 'ada@example.com' })
    bus.emit('form.submit', { email: 'grace@example.com' })
    chain.stop({ force: true })

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.aborted, true)
  })
})
