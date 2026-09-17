import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { createFlow, createPubSub, EnqueueError, PoolError, type EventMap, type Bus } from '~/index'

const flush = async (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

type Ctx = Record<string, never>

type Deferred = {
  id: string
  resolve: () => void
}

const createHarness = () => {
  const started: string[] = []
  const deferred: Deferred[] = []
  const action = ({ input }: { input: Record<string, unknown> }) => {
    const id = input.id as string

    started.push(id)
    return new Promise<void>((resolve) => deferred.push({ id, resolve }))
  }
  const settle = (id: string) => {
    const index = deferred.findIndex((item) => item.id === id)

    if (index >= 0) {
      deferred.splice(index, 1)[0]?.resolve()
    }
  }
  return { started, deferred, action, settle }
}

describe('flow workers pool', () => {
  type Events = { job: { id: string } }

  it('runs different keys in parallel and serializes the same key', async () => {
    const bus = createPubSub<Events>()
    const { started, action, settle } = createHarness()
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: { work: action },
        events: {
          '[bus] job': {
            entrypoint: 'job',
            options: { concurrency: { mode: 'workers', key: ({ id }) => id.charAt(0), workers: 2 } },
          },
        },
        config: { entrypoints: { job: 'work' }, strategies: { work: { fn: 'work' } } },
      },
      { bus, context: {} }
    )

    flow.start()
    bus.emit('job', { id: 'a1' })
    bus.emit('job', { id: 'a2' })
    bus.emit('job', { id: 'b1' })
    await flush()

    assert.deepEqual(started, ['a1', 'b1'])

    settle('b1')
    await flush()
    assert.deepEqual(started, ['a1', 'b1'])

    settle('a1')
    await flush()
    assert.deepEqual(started, ['a1', 'b1', 'a2'])

    settle('a2')
    flow.stop({ force: true })
  })

  it('picks a free line without waiting for a busy one', async () => {
    const bus = createPubSub<Events>()
    const { started, action, settle } = createHarness()
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: { work: action },
        events: {
          '[bus] job': {
            entrypoint: 'job',
            options: { concurrency: { mode: 'workers', key: ({ id }) => id.charAt(0), workers: 2 } },
          },
        },
        config: { entrypoints: { job: 'work' }, strategies: { work: { fn: 'work' } } },
      },
      { bus, context: {} }
    )

    flow.start()
    bus.emit('job', { id: 'a1' })
    bus.emit('job', { id: 'b1' })
    bus.emit('job', { id: 'b2' })
    await flush()
    assert.deepEqual(started, ['a1', 'b1'])

    settle('b1')
    await flush()
    assert.deepEqual(started, ['a1', 'b1', 'b2'])

    settle('a1')
    settle('b2')
    flow.stop({ force: true })
  })

  it('drops the event when a worker key cannot be resolved', async () => {
    const bus = createPubSub<Events>()
    const dropped: string[] = []
    const diagnosticBus = bus as Bus<EventMap>

    diagnosticBus.on('slapflow.run.dropped', ({ parsed }) =>
      dropped.push(String((parsed as { reason?: unknown }).reason))
    )
    const { started, action } = createHarness()
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: { work: action },
        events: {
          '[bus] job': {
            entrypoint: 'job',
            options: { concurrency: { mode: 'workers', key: '$input.missing', workers: 1 } },
          },
        },
        config: { entrypoints: { job: 'work' }, strategies: { work: { fn: 'work' } } },
      },
      { bus, context: {} }
    )

    flow.start()
    bus.emit('job', { id: 'a1' })
    await flush()

    assert.deepEqual(started, [])
    assert.deepEqual(dropped, ['key-invalid'])
  })

  it('rejects a binding whose key is a bare string', () => {
    const bus = createPubSub<Events>()
    const { started, action } = createHarness()
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: { work: action },
        events: {
          '[bus] job': {
            entrypoint: 'job',
            options: { concurrency: { mode: 'workers', key: 'colonyId', workers: 1 } },
          },
        },
        config: { entrypoints: { job: 'work' }, strategies: { work: { fn: 'work' } } },
      },
      { bus, context: {} }
    )

    const result = flow.start()

    assert.equal(result.validation.ok, false)
    assert.equal(
      result.validation.errors.some((issue) => issue.code === 'KEY_INVALID'),
      true
    )
    assert.deepEqual(result.active, [])
    assert.deepEqual(started, [])
  })

  it('runs a workers binding without a key on an implicit line', async () => {
    const bus = createPubSub<Events>()
    const { started, action, settle } = createHarness()
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: { work: action },
        events: {
          '[bus] job': { entrypoint: 'job', options: { concurrency: { mode: 'workers', workers: 1 } } },
        },
        config: { entrypoints: { job: 'work' }, strategies: { work: { fn: 'work' } } },
      },
      { bus, context: {} }
    )

    flow.start()
    bus.emit('job', { id: 'a1' })
    await flush()

    assert.deepEqual(started, ['a1'])
    assert.deepEqual(flow.poolStats()['[bus] job']?.perKey[''], {
      active: 1,
      queued: 0,
      oldestQueuedMs: 0,
    })

    settle('a1')
    flow.stop({ force: true })
  })
})

describe('flow named pools', () => {
  type Events = { dispatch: { id: string }; legacy: { id: string } }

  const createDispatchFlow = (options: {
    events: 'off' | 'sampled' | 'all'
    maxQueueSize: number
    overflow: 'wait' | 'drop-newest'
    context: Ctx | (() => Ctx)
  }) => {
    const bus = createPubSub<Events>()
    const { started, action, settle, deferred } = createHarness()
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: {
          work: action,
          dispatch: async ({ input, runtime }) => {
            await runtime.enqueue?.('work', { id: (input as { id: string }).id }, { pool: 'p', key: String(input.id) })
          },
        },
        events: {
          '[bus] dispatch': { entrypoint: 'dispatch', options: { concurrency: { mode: 'parallel' } } },
        },
        config: {
          entrypoints: { dispatch: 'dispatch', work: 'work' },
          strategies: { dispatch: { fn: 'dispatch' }, work: { fn: 'work' } },
        },
      },
      {
        bus,
        context: options.context,
        pools: {
          p: { workers: 1, maxQueueSize: options.maxQueueSize, overflow: options.overflow, events: options.events },
        },
      }
    )
    return { bus, started, settle, deferred, flow }
  }

  it('applies backpressure instead of dropping accepted work', async () => {
    const { bus, started, settle, flow } = createDispatchFlow({
      events: 'all',
      maxQueueSize: 1,
      overflow: 'wait',
      context: {},
    })

    flow.start()
    bus.emit('dispatch', { id: '1' })
    bus.emit('dispatch', { id: '2' })
    bus.emit('dispatch', { id: '3' })
    await flush()

    assert.deepEqual(started, ['1'])

    settle('1')
    await flush()
    assert.deepEqual(started, ['1', '2'])

    settle('2')
    await flush()
    assert.deepEqual(started, ['1', '2', '3'])

    settle('3')
    flow.stop({ force: true })
  })

  it('reports pool stats and evicts idle key lines', async () => {
    const { bus, started, settle, flow } = createDispatchFlow({
      events: 'all',
      maxQueueSize: 4,
      overflow: 'wait',
      context: {},
    })

    flow.start()
    bus.emit('dispatch', { id: '1' })
    bus.emit('dispatch', { id: '2' })
    await flush()

    const stats = flow.poolStats('p')

    assert.equal(stats.active, 1)
    assert.equal(stats.queued, 1)
    assert.deepEqual(Object.keys(stats.perKey).sort(), ['1', '2'])
    assert.throws(() => flow.poolStats('missing'), PoolError)

    settle('1')
    await flush()
    settle('2')
    await flush()
    assert.deepEqual(flow.poolStats('p').perKey, {})
    assert.deepEqual(started, ['1', '2'])
    flow.stop({ force: true })
  })

  it('rejects enqueue into the current pool and into an unknown pool', async () => {
    const bus = createPubSub<Events>()
    const codes: string[] = []
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: {
          probe: async ({ runtime }) => {
            try {
              await runtime.enqueue?.('probe', {}, { pool: 'p' })
            } catch (error) {
              codes.push((error as EnqueueError).slapError.code)
            }
            try {
              await runtime.enqueue?.('probe', {}, { pool: 'nope' })
            } catch (error) {
              codes.push((error as EnqueueError).slapError.code)
            }
          },
        },
        events: {
          '[bus] dispatch': {
            entrypoint: 'probe',
            options: { concurrency: { mode: 'workers', pool: 'p', key: () => 'k' } },
          },
        },
        config: { entrypoints: { probe: 'probe' }, strategies: { probe: { fn: 'probe' } } },
      },
      { bus, context: {}, pools: { p: { workers: 1 } } }
    )

    flow.start()
    bus.emit('dispatch', { id: '1' })
    await flush()

    assert.deepEqual(codes, ['ENQUEUE_SELF_POOL', 'ENQUEUE_UNKNOWN_POOL'])
    flow.stop({ force: true })
  })

  it('publishes overflow but gates task and pooled run events', async () => {
    const bus = createPubSub<Events>()
    const diagnostics: string[] = []
    const diagnosticBus = bus as Bus<EventMap>

    for (const topic of [
      'slapflow.task.queued',
      'slapflow.task.started',
      'slapflow.task.finished',
      'slapflow.run.started',
      'slapflow.queue.overflow',
    ]) {
      diagnosticBus.on(topic, () => diagnostics.push(topic))
    }
    const { started, action, settle } = createHarness()
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: { work: action },
        events: {
          '[bus] dispatch': {
            entrypoint: 'work',
            options: { concurrency: { mode: 'workers', pool: 'p', key: ({ id }) => id } },
          },
        },
        config: { entrypoints: { work: 'work' }, strategies: { work: { fn: 'work' } } },
      },
      { bus, context: {}, pools: { p: { workers: 1, maxQueueSize: 1, overflow: 'drop-newest', events: 'off' } } }
    )

    flow.start()
    bus.emit('dispatch', { id: '1' })
    bus.emit('dispatch', { id: '2' })
    bus.emit('dispatch', { id: '3' })
    await flush()

    assert.deepEqual(started, ['1'])
    assert.deepEqual(diagnostics, ['slapflow.queue.overflow'])
    settle('1')
    settle('2')
    flow.stop({ force: true })
  })

  it('coalesces queued signals with the same token', async () => {
    const bus = createPubSub<Events>()
    const { started, action, settle } = createHarness()
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: {
          work: action,
          tick: async ({ input, runtime }) => {
            await runtime.enqueue?.(
              'work',
              { id: (input as { id: string }).id },
              { pool: 'p', key: 'colony', coalesceToken: 'colony' }
            )
          },
        },
        events: {
          '[bus] dispatch': { entrypoint: 'tick', options: { concurrency: { mode: 'parallel' } } },
        },
        config: {
          entrypoints: { tick: 'tick', work: 'work' },
          strategies: { tick: { fn: 'tick' }, work: { fn: 'work' } },
        },
      },
      { bus, context: {}, pools: { p: { workers: 1 } } }
    )

    flow.start()
    bus.emit('dispatch', { id: '1' })
    await flush()
    bus.emit('dispatch', { id: '2' })
    bus.emit('dispatch', { id: '3' })
    await flush()

    assert.deepEqual(started, ['1'])
    assert.equal(flow.poolStats('p').queued, 1)

    settle('1')
    await flush()
    assert.deepEqual(started, ['1', '3'])

    settle('3')
    flow.stop({ force: true })
  })

  it('resets queued pool work on start', async () => {
    const { bus, started, settle, flow } = createDispatchFlow({
      events: 'all',
      maxQueueSize: 4,
      overflow: 'wait',
      context: {},
    })

    flow.start()
    bus.emit('dispatch', { id: '1' })
    await flush()
    bus.emit('dispatch', { id: '2' })
    await flush()
    assert.deepEqual(started, ['1'])

    flow.start()
    assert.equal(flow.poolStats('p').queued, 0)

    settle('1')
    flow.stop({ force: true })
  })

  it('drains active work and resolves once empty', async () => {
    const { bus, started, settle, flow } = createDispatchFlow({
      events: 'all',
      maxQueueSize: 4,
      overflow: 'wait',
      context: {},
    })

    flow.start()
    bus.emit('dispatch', { id: '1' })
    await flush()

    const drained = flow.drain()
    let settled = false

    void drained.then(() => {
      settled = true
    })
    await flush()
    assert.equal(settled, false)

    settle('1')
    await flush()
    assert.deepEqual(await drained, { drained: true, remaining: 0 })
    assert.deepEqual(started, ['1'])

    flow.stop({ force: true })
  })

  it('returns the remaining count on drain timeout', async () => {
    vi.useFakeTimers()
    try {
      const bus = createPubSub<Events>()
      const { action } = createHarness()
      const flow = createFlow<Ctx, unknown, Events>(
        {
          actions: { work: action },
          events: {
            '[bus] dispatch': {
              entrypoint: 'work',
              options: { concurrency: { mode: 'workers', pool: 'p', key: ({ id }) => id } },
            },
          },
          config: { entrypoints: { work: 'work' }, strategies: { work: { fn: 'work' } } },
        },
        { bus, context: {}, pools: { p: { workers: 1 } } }
      )

      flow.start()
      bus.emit('dispatch', { id: '1' })
      await vi.advanceTimersByTimeAsync(0)

      const pending = flow.drain({ timeoutMs: 100 })

      await vi.advanceTimersByTimeAsync(100)
      assert.deepEqual(await pending, { drained: false, remaining: 1 })
      flow.stop({ force: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a binding that references a pool without mode "workers"', () => {
    const bus = createPubSub<Events>()
    const flow = createFlow<Ctx, unknown, Events>(
      {
        events: {
          '[bus] dispatch': {
            entrypoint: 'work',
            options: { concurrency: { mode: 'queue', pool: 'p', key: ({ id }) => id } },
          },
        },
        config: { entrypoints: { work: 'work' }, strategies: { work: { fn: 'core.noop' } } },
      },
      { bus, context: () => ({}), pools: { p: { workers: 1 } } }
    )

    const started = flow.start()

    assert.equal(started.validation.ok, false)
    assert.equal(
      started.validation.errors.some((issue) => issue.code === 'POOL_MODE_INVALID'),
      true
    )
    assert.deepEqual(started.active, [])
  })

  it('rejects a pool with a non-positive workers value', () => {
    const bus = createPubSub<Events>()
    const flow = createFlow<Ctx, unknown, Events>(
      {
        events: {
          '[bus] dispatch': {
            entrypoint: 'work',
            options: { concurrency: { mode: 'workers', pool: 'p', key: ({ id }) => id } },
          },
        },
        config: { entrypoints: { work: 'work' }, strategies: { work: { fn: 'core.noop' } } },
      },
      { bus, context: () => ({}), pools: { p: { workers: 0 } } }
    )

    const started = flow.start()

    assert.equal(started.validation.ok, false)
    assert.equal(
      started.validation.errors.some((issue) => issue.code === 'POOL_WORKERS_INVALID'),
      true
    )
  })

  it('warns about ignored pool fields, stray workers, and a non-factory context', () => {
    const bus = createPubSub<Events>()
    const flow = createFlow<Ctx, unknown, Events>(
      {
        events: {
          '[bus] dispatch': {
            entrypoint: 'work',
            options: { concurrency: { mode: 'workers', pool: 'p', key: ({ id }) => id, overflow: 'wait' } },
          },
          '[bus] legacy': {
            entrypoint: 'work',
            options: { concurrency: { mode: 'queue', workers: 2, key: '$input.id', coalesce: '$input.id' } },
          },
        },
        config: { entrypoints: { work: 'work' }, strategies: { work: { fn: 'core.noop' } } },
      },
      { bus, context: {}, pools: { p: { workers: 1 } } }
    )

    const codes = flow.start().validation.warnings.map((issue) => issue.code)

    assert.ok(codes.includes('POOL_FIELDS_IGNORED'))
    assert.ok(codes.includes('WORKERS_IGNORED'))
    assert.ok(codes.includes('KEY_IGNORED'))
    assert.ok(codes.includes('COALESCE_IGNORED'))
    assert.ok(codes.includes('CONTEXT_NOT_FACTORY'))
  })

  it('samples pooled run events by interval', async () => {
    const bus = createPubSub<Events>()
    const events: string[] = []
    const { started, action, settle } = createHarness()

    ;(bus as Bus<EventMap>).on('slapflow.run.started', () => events.push('run.started'))
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: { work: action },
        events: {
          '[bus] dispatch': {
            entrypoint: 'work',
            options: { concurrency: { mode: 'workers', pool: 'p', key: ({ id }) => id } },
          },
        },
        config: { entrypoints: { work: 'work' }, strategies: { work: { fn: 'work' } } },
      },
      {
        bus,
        context: () => ({}),
        pools: { p: { workers: 1, events: 'sampled', eventsMinIntervalMs: 1_000_000 } },
      }
    )

    flow.start()
    bus.emit('dispatch', { id: '1' })
    await flush()
    settle('1')
    await flush()
    bus.emit('dispatch', { id: '2' })
    await flush()

    assert.deepEqual(started, ['1', '2'])
    assert.deepEqual(events, ['run.started'])

    settle('2')
    flow.stop({ force: true })
  })

  it('publishes run.failed even when pool events are off', async () => {
    const bus = createPubSub<Events>()
    const failed: string[] = []
    const { action } = createHarness()

    ;(bus as Bus<EventMap>).on('slapflow.run.failed', () => failed.push('failed'))
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: {
          work: action,
          boom: () => ({ type: 'fail' as const, reason: 'blocked' }),
        },
        events: {
          '[bus] dispatch': {
            entrypoint: 'boom',
            options: { concurrency: { mode: 'workers', pool: 'p', key: ({ id }) => id } },
          },
        },
        config: { entrypoints: { boom: 'boom' }, strategies: { boom: { fn: 'boom' } } },
      },
      { bus, context: () => ({}), pools: { p: { workers: 1, events: 'off' } } }
    )

    flow.start()
    bus.emit('dispatch', { id: '1' })
    await flush()

    assert.deepEqual(failed, ['failed'])
    flow.stop({ force: true })
  })

  it('emits run.dropped chain-stopped for queued pool work on stop', async () => {
    const bus = createPubSub<Events>()
    const reasons: string[] = []
    const { action } = createHarness()

    ;(bus as Bus<EventMap>).on('slapflow.run.dropped', ({ parsed }) =>
      reasons.push(String((parsed as { reason?: unknown }).reason))
    )
    const flow = createFlow<Ctx, unknown, Events>(
      {
        actions: { work: action },
        events: {
          '[bus] dispatch': {
            entrypoint: 'work',
            options: { concurrency: { mode: 'workers', pool: 'p', key: ({ id }) => id } },
          },
        },
        config: { entrypoints: { work: 'work' }, strategies: { work: { fn: 'work' } } },
      },
      { bus, context: () => ({}), pools: { p: { workers: 1 } } }
    )

    flow.start()
    bus.emit('dispatch', { id: '1' })
    await flush()
    bus.emit('dispatch', { id: '2' })
    await flush()

    flow.stop()

    assert.ok(reasons.includes('chain-stopped'))
    flow.stop({ force: true })
  })
})
