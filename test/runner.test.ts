import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { createRunner } from '~/runner'

type Ctx = {
  worker?: { state?: string; queueSize?: number }
  now?: number
  last?: number
  log?: string[]
  target?: string
}

describe('runner', () => {
  it('sequence executes in order and collects patches', async () => {
    const runner = createRunner<Ctx, string>()
    runner.registerActions({
      a: () => ({ patch: 'a' }),
      b: () => ({ patch: 'b' }),
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.sequence', mode: 'sequence', then: ['sa', 'sb'] },
        sa: { fn: 'a' },
        sb: { fn: 'b' },
      },
    })

    const result = await runner.run('root', {})
    assert.equal(result.status, 'success')
    assert.deepEqual(result.patches, ['a', 'b'])
  })

  it('selector stops on first successful branch and treats false as skip', async () => {
    const runner = createRunner<Ctx, string>()
    runner.registerActions({
      skip: () => false,
      win: () => ({ patch: 'win' }),
      later: () => ({ patch: 'later' }),
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.selector', mode: 'selector', then: ['skip', 'win', 'later'] },
        skip: { fn: 'skip' },
        win: { fn: 'win' },
        later: { fn: 'later' },
      },
    })

    const result = await runner.run('root', {})
    assert.equal(result.status, 'success')
    assert.deepEqual(result.patches, ['win'])
  })

  it('thrown error invokes catch', async () => {
    const runner = createRunner<Ctx, string>()
    runner.registerActions({
      boom: () => {
        throw new Error('boom')
      },
      recover: () => ({ patch: 'recovered' }),
    })
    runner.loadConfig({ strategies: { root: { fn: 'boom', catch: ['recover'] }, recover: { fn: 'recover' } } })

    const result = await runner.run('root', {})
    assert.equal(result.status, 'success')
    assert.deepEqual(result.patches, ['recovered'])
  })

  it('marks a failed recovery branch with the catch phase', async () => {
    const runner = createRunner<Ctx>()
    runner.registerActions({
      boom: () => {
        throw new Error('boom')
      },
      recoveryFails: () => {
        throw new Error('recovery failed')
      },
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'boom', catch: ['recover'] },
        recover: { fn: 'recoveryFails' },
      },
    })

    const result = await runner.run('root', {})

    assert.equal(result.status, 'failed')
    assert.equal(result.error?.stage?.phase, 'catch')
  })

  it('reports missing action and missing strategy', async () => {
    const runner = createRunner<Ctx>()
    runner.loadConfig({ strategies: { root: { fn: 'missing' } } })
    assert.equal((await runner.run('root', {})).error?.code, 'ACTION_NOT_FOUND')
    assert.equal((await runner.run('absent', {})).error?.code, 'STRATEGY_NOT_FOUND')
  })

  it('when reads context, data and input', async () => {
    const runner = createRunner<Ctx, string>()
    runner.registerAction('mark', () => ({ patch: 'ok' }))
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.sequence', then: ['setContext', 'setData', 'mark'] },
        setContext: { fn: 'core.set', props: { path: 'target', value: '$input.target' } },
        setData: { fn: 'core.setData', props: { path: 'target', value: '$input.target' } },
        mark: {
          fn: 'mark',
          when: [
            'and',
            ['eq', '$context.worker.state', 'idle'],
            ['eq', '$context.target', '$input.target'],
            ['eq', '$data.target', '$input.target'],
          ],
        },
      },
    })
    const result = await runner.run('root', { worker: { state: 'idle' } }, { target: 'job-1' })
    assert.deepEqual(result.patches, ['ok'])
    assert.equal(result.context.target, 'job-1')
    assert.equal(result.data.target, 'job-1')
  })

  it('runSync throws on async action', () => {
    const runner = createRunner<Ctx>()
    runner.loadConfig({ strategies: { root: { fn: 'core.delay', props: { ms: 0 } } } })
    assert.throws(() => runner.runSync('root', {}), /async action|Promise/)
  })

  it('core.delay settles promptly when the run is aborted', async () => {
    const runner = createRunner<Ctx>()
    const controller = new AbortController()
    const startedAt = Date.now()

    runner.loadConfig({ strategies: { root: { fn: 'core.delay', props: { ms: 1_000 } } } })
    setTimeout(() => controller.abort(), 10)
    await runner.run('root', {}, {}, { signal: controller.signal })

    assert.equal(Date.now() - startedAt < 100, true)
  })

  it('core.loop executes then on every interval until aborted', async () => {
    const runner = createRunner<Ctx>()
    const controller = new AbortController()
    let calls = 0

    runner.registerAction('tick', () => {
      calls += 1
      if (calls === 3) {
        controller.abort()
      }
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.loop', props: { duration: 1 }, then: ['tick'] },
        tick: { fn: 'tick' },
      },
    })

    const result = await runner.run('root', {}, {}, { signal: controller.signal })

    assert.equal(result.status, 'success')
    assert.equal(calls, 3)
  })

  it('core.loop executes the first iteration immediately when configured', async () => {
    const runner = createRunner<Ctx>()
    const controller = new AbortController()
    let calls = 0

    runner.registerAction('tick', () => {
      calls += 1
      controller.abort()
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.loop', props: { duration: 100, immediate: true }, then: ['tick'] },
        tick: { fn: 'tick' },
      },
    })

    const fallback = setTimeout(() => controller.abort(), 20)
    const result = await runner.run('root', {}, {}, { signal: controller.signal })
    clearTimeout(fallback)

    assert.equal(result.status, 'success')
    assert.equal(calls, 1)
  })

  it('core.loop counts the immediate iteration toward max', async () => {
    const runner = createRunner<Ctx>()
    let calls = 0

    runner.registerAction('tick', () => {
      calls += 1
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.loop', props: { duration: 100, immediate: true, max: 1 }, then: ['tick'] },
        tick: { fn: 'tick' },
      },
    })

    const result = await runner.run('root', {})

    assert.equal(result.status, 'success')
    assert.equal(calls, 1)
  })

  it('core.loop stops after the configured maximum number of iterations', async () => {
    const runner = createRunner<Ctx>()
    let calls = 0

    runner.registerAction('tick', () => {
      calls += 1
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.loop', props: { duration: 1, immediate: true, max: 3 }, then: ['tick'] },
        tick: { fn: 'tick' },
      },
    })

    const result = await runner.run('root', {})

    assert.equal(result.status, 'success')
    assert.equal(calls, 3)
  })

  it('core.loop treats max -1 as unlimited until aborted', async () => {
    const runner = createRunner<Ctx>()
    const controller = new AbortController()
    let calls = 0

    runner.registerAction('tick', () => {
      calls += 1
      if (calls === 3) {
        controller.abort()
      }
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.loop', props: { duration: 1, immediate: true, max: -1 }, then: ['tick'] },
        tick: { fn: 'tick' },
      },
    })

    const result = await runner.run('root', {}, {}, { signal: controller.signal })

    assert.equal(result.status, 'success')
    assert.equal(calls, 3)
  })

  it('core.loop uses the default maximum when max is absent', async () => {
    vi.useFakeTimers()

    try {
      const runner = createRunner<Ctx>({ maxStepCount: -1 })
      let calls = 0

      runner.registerAction('tick', () => {
        calls += 1
      })
      runner.loadConfig({
        strategies: {
          root: { fn: 'core.loop', props: { duration: 1, immediate: true }, then: ['tick'] },
          tick: { fn: 'tick' },
        },
      })

      const resultPromise = runner.run('root', {})
      await vi.advanceTimersByTimeAsync(999)
      const result = await resultPromise

      assert.equal(result.status, 'success')
      assert.equal(calls, 999)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['zero', 0],
    ['less than -1', -2],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('core.loop uses the default maximum when max is %s', async (_name, max) => {
    vi.useFakeTimers()

    try {
      const runner = createRunner<Ctx>({ maxStepCount: -1 })
      let calls = 0

      runner.registerAction('tick', () => {
        calls += 1
      })
      runner.loadConfig({
        strategies: {
          root: { fn: 'core.loop', props: { duration: 1, immediate: true, max }, then: ['tick'] },
          tick: { fn: 'tick' },
        },
      })

      const resultPromise = runner.run('root', {})
      await vi.advanceTimersByTimeAsync(999)
      const result = await resultPromise

      assert.equal(result.status, 'success')
      assert.equal(calls, 999)
    } finally {
      vi.useRealTimers()
    }
  })

  it('core.loop resolves on abort even if the then branch never settles', async () => {
    const runner = createRunner<Ctx>()
    const controller = new AbortController()

    runner.registerAction('stuck', () => new Promise<void>(() => {}))
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.loop', props: { duration: 1 }, then: ['stuck'] },
        stuck: { fn: 'stuck' },
      },
    })

    setTimeout(() => controller.abort(), 10)
    const result = await runner.run('root', {}, {}, { signal: controller.signal })

    assert.equal(result.status, 'success')
  })

  it('core.loop executes its then branch in parallel mode', async () => {
    const runner = createRunner<Ctx>()
    const controller = new AbortController()
    let active = 0
    let maxActive = 0
    let completed = 0

    const action = async (): Promise<void> => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      completed += 1
      if (completed === 2) {
        controller.abort()
      }
    }

    runner.registerActions({ first: action, second: action })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.loop', mode: 'parallel', props: { duration: 1 }, then: ['first', 'second'] },
        first: { fn: 'first' },
        second: { fn: 'second' },
      },
    })

    const result = await runner.run('root', {}, {}, { signal: controller.signal })

    assert.equal(result.status, 'success')
    assert.equal(maxActive, 2)
    assert.equal(completed, 2)
  })

  it('maxStepCount stops cycles', async () => {
    const runner = createRunner<Ctx>({ maxStepCount: 3 })
    runner.loadConfig({ strategies: { root: { fn: 'core.noop', then: ['root'] } } })
    const result = await runner.run('root', {})
    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'MAX_STEPS')
  })

  it('shares maxStepCount across parallel branches', async () => {
    const runner = createRunner<Ctx>({ maxStepCount: 2 })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.parallel', mode: 'parallel', then: ['first', 'second'] },
        first: { fn: 'core.noop' },
        second: { fn: 'core.noop' },
      },
    })

    const result = await runner.run('root', {})

    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'MAX_STEPS')
    assert.equal(result.steps, 2)
  })

  it('trace contains strategy props status and duration', async () => {
    const runner = createRunner<Ctx>({ trace: true })
    runner.loadConfig({ strategies: { root: { fn: 'core.noop', props: { x: 1 } } } })
    const result = await runner.run('root', {})
    assert.deepEqual(
      {
        strategy: result.trace?.[0]?.strategy,
        props: result.trace?.[0]?.props,
        status: result.trace?.[0]?.status,
      },
      { strategy: 'root', props: { x: 1 }, status: 'success' }
    )
    assert.equal(typeof result.trace?.[0]?.durationMs, 'number')
  })

  it('parallel preserves patch order from config', async () => {
    const runner = createRunner<Ctx, string>()
    runner.registerActions({
      slow: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return { patch: 'slow' }
      },
      fast: () => ({ patch: 'fast' }),
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.parallel', mode: 'parallel', then: ['slow', 'fast'] },
        slow: { fn: 'slow' },
        fast: { fn: 'fast' },
      },
    })
    const result = await runner.run('root', {})
    assert.deepEqual(result.patches, ['slow', 'fast'])
  })

  it('parallel isolates nested runtime data and accepts service context values', async () => {
    const service = () => undefined
    const runner = createRunner<{ service: () => void }, string>()
    runner.registerActions({
      prepare: ({ runtime }) => runtime.data.set('shared', { value: 'initial' }),
      write: ({ runtime }) => runtime.data.set('shared.value', 'changed'),
      read: ({ runtime }) => ({ patch: String(runtime.data.get('shared.value') ?? 'initial') }),
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.sequence', then: ['prepare', 'parallel'] },
        prepare: { fn: 'prepare' },
        parallel: { fn: 'core.parallel', mode: 'parallel', then: ['write', 'read'] },
        write: { fn: 'write' },
        read: { fn: 'read' },
      },
    })

    const result = await runner.run('root', { service })

    assert.equal(result.status, 'success')
    assert.deepEqual(result.patches, ['initial'])
  })

  it('core.fetch retries HTTP failures and stores a parsed response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'order-1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const runner = createRunner<Ctx>()
    runner.loadConfig({
      strategies: {
        root: {
          fn: 'core.fetch',
          props: {
            url: 'https://example.test/orders/1',
            response: 'json',
            dataPath: 'order',
            retry: { initialDelay: 0, jitter: false },
          },
        },
      },
    })

    const result = await runner.run('root', {})

    assert.equal(result.status, 'success')
    assert.equal(fetchMock.mock.calls.length, 2)
    assert.deepEqual(result.data, {
      order: {
        status: 200,
        ok: true,
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: { id: 'order-1' },
      },
    })
    vi.unstubAllGlobals()
  })

  it('core.fetch reads text and blob responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('ready', { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(['image'], { type: 'image/png' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const runner = createRunner<Ctx>()
    runner.loadConfig({
      strategies: {
        text: { fn: 'core.fetch', props: { url: 'https://example.test/status', response: 'text', dataPath: 'text' } },
        blob: { fn: 'core.fetch', props: { url: 'https://example.test/image', response: 'blob', dataPath: 'blob' } },
      },
    })

    const textResult = await runner.run('text', {})
    const blobResult = await runner.run('blob', {})

    assert.equal((textResult.data.text as { body: unknown }).body, 'ready')
    assert.equal((blobResult.data.blob as { body: unknown }).body instanceof Blob, true)
    vi.unstubAllGlobals()
  })

  it('isolates context mutations in parallel branches', async () => {
    const runner = createRunner<{ values: Record<string, boolean> }>()
    runner.registerActions({
      first: ({ runtime }) => runtime.set('values.first', true),
      second: ({ runtime }) => runtime.set('values.second', true),
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.parallel', mode: 'parallel', then: ['first', 'second'] },
        first: { fn: 'first' },
        second: { fn: 'second' },
      },
    })

    const result = await runner.run('root', { values: {} })

    assert.deepEqual(result.context, { values: {} })
  })

  it('ui flow returns events', async () => {
    const runner = createRunner<Ctx>()
    runner.loadConfig({
      strategies: { root: { fn: 'core.emit', props: { type: 'ui.message', payload: { text: 'ok' } } } },
    })
    const result = await runner.run('root', {})
    assert.deepEqual(result.events, [{ type: 'ui.message', payload: { text: 'ok' } }])
  })
})
