import assert from 'node:assert/strict'
import { describe, expect, it, vi } from 'vitest'
import { createRunner } from '~/createRunner'
import { evaluateCondition } from '~/evaluateCondition'
import { evaluateConditionWithRegistry } from '~/helpers/conditions/evaluateConditionWithRegistry'
import { createMemoryTraceSink, type Config } from '~/index'
import { createRuntime } from '~/helpers/runner/createRuntime'
import { type RunState } from '~/helpers/runner/runnerTypes'
import {
  type TraceEntry,
  type StrategyTiming,
  type ActionArgs,
  type Runtime,
  type ConditionExpression,
  type TypeRules,
} from '~/types'

type TimingContext = { calls: number; catches: number }

type Ctx = {
  seen?: boolean
  user?: {
    name?: string
    profile?: {
      title?: string
    }
  }
}

describe('validation', () => {
  it('reports invalid config shapes and strategy fields', () => {
    const runner = createRunner<Ctx>()

    assert.deepEqual(
      runner.validateConfig(undefined).errors.map((error) => error.code),
      ['CONFIG_INVALID']
    )

    const result = runner.validateConfig({
      strategies: {
        root: { fn: '', mode: 'invalid' as never },
      },
    })

    assert.equal(result.ok, false)
    assert.deepEqual(new Set(result.errors.map((error) => error.code)), new Set(['FN_MISSING', 'MODE_INVALID']))

    const missingStrategies = runner.validateConfig({} as Config)

    assert.equal(missingStrategies.ok, false)
    assert.deepEqual(
      missingStrategies.errors.map((error) => error.code),
      ['CONFIG_INVALID']
    )
  })

  it('reports missing then, catch and entrypoint targets', () => {
    const runner = createRunner<Ctx>()
    const result = runner.validateConfig({
      entrypoints: { start: 'missing.entrypoint' },
      strategies: {
        root: { fn: 'core.noop', then: ['missing.then'], catch: ['missing.catch'] },
      },
    })

    assert.deepEqual(new Set(result.errors.map((error) => error.code)), new Set(['STRATEGY_NOT_FOUND']))
    assert.equal(result.errors.length, 3)
  })

  it('reports invalid path refs in props and nested conditions', () => {
    const runner = createRunner<Ctx>()
    const result = runner.validateConfig({
      strategies: {
        root: {
          fn: 'core.noop',
          props: { value: '$bad.path' },
          when: ['and', ['eq', '$context.user.name', '$wat.value']],
        },
      },
    })

    assert.equal(result.ok, false)
    assert.deepEqual(result.errors.map((error) => error.code).sort(), ['PATH_INVALID', 'PATH_INVALID'])
  })

  it('treats cycles without terminal as errors and terminal cycles as warnings', () => {
    const runner = createRunner<Ctx>()
    const invalid = runner.validateConfig({
      strategies: {
        root: { fn: 'core.noop', then: ['again'] },
        again: { fn: 'core.noop', then: ['root'] },
      },
    })
    const terminal = runner.validateConfig({
      strategies: {
        root: { fn: 'core.noop', then: ['again'] },
        again: { fn: 'core.noop', terminal: true, then: ['root'] },
      },
    })

    assert.equal(
      invalid.errors.some((error) => error.code === 'CYCLE_DETECTED'),
      true
    )
    assert.equal(terminal.ok, true)
    assert.equal(
      terminal.warnings.some((warning) => warning.code === 'CYCLE_DETECTED'),
      true
    )
  })

  it('detects cycles through catch branches', () => {
    const runner = createRunner<Ctx>()
    const result = runner.validateConfig({
      strategies: {
        root: { fn: 'core.noop', catch: ['recover'] },
        recover: { fn: 'core.noop', catch: ['root'] },
      },
    })

    assert.equal(
      result.errors.some((error) => error.code === 'CYCLE_DETECTED'),
      true
    )
  })

  it('warns when runner safety limits are disabled', () => {
    const runner = createRunner<Ctx>({ maxStepCount: -1, maxDepth: -1 })
    const result = runner.validateConfig({
      strategies: {
        root: { fn: 'core.noop' },
      },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(
      result.warnings.map(({ code, path }) => ({ code, path })),
      [
        { code: 'LIMIT_DISABLED', path: 'options.maxStepCount' },
        { code: 'LIMIT_DISABLED', path: 'options.maxDepth' },
      ]
    )
  })

  it('rejects direct and transitive nested loops through then and catch', () => {
    const runner = createRunner<Ctx>()
    const direct = runner.validateConfig({
      strategies: {
        outer: { fn: 'core.loop', then: [{ strategy: 'inner' }] },
        inner: { fn: 'core.loop' },
      },
    })
    const transitive = runner.validateConfig({
      strategies: {
        outer: { fn: 'core.loop', then: ['flow'] },
        flow: { fn: 'core.sequence', catch: ['recover'] },
        recover: { fn: 'core.noop', then: ['inner'] },
        inner: { fn: 'core.loop' },
      },
    })

    assert.equal(
      direct.errors.some((error) => error.code === 'NESTED_LOOP'),
      true
    )
    assert.equal(
      transitive.errors.some((error) => error.code === 'NESTED_LOOP'),
      true
    )
  })

  it('allows sibling loops in parallel branches', () => {
    const runner = createRunner<Ctx>()
    const result = runner.validateConfig({
      strategies: {
        root: { fn: 'core.parallel', mode: 'parallel', then: ['first', 'second'] },
        first: { fn: 'core.loop', then: ['first.action'] },
        second: { fn: 'core.loop', then: ['second.action'] },
        'first.action': { fn: 'core.noop' },
        'second.action': { fn: 'core.noop' },
      },
    })

    assert.equal(result.ok, true)
    assert.equal(
      result.errors.some((error) => error.code === 'NESTED_LOOP'),
      false
    )
  })
})

describe('runtime helpers', () => {
  it('reads, writes, resolves, emits, patches, stops and fails through runtime', () => {
    const state: RunState<Ctx, string> = {
      context: { user: { name: 'Ada' } },
      input: { job: { id: 'job-1' } },
      data: {},
      patches: [],
      events: [],
      stepCounter: { current: 0 },
      startedAt: Date.now(),
      sync: false,
      signal: new AbortController().signal,
      abort: () => undefined,
      closed: false,
      reportedErrors: [],
      variables: {},
      expressions: {},
    }
    const runtime = createRuntime(state)

    runtime.set('user.profile.title', 'Engineer')
    runtime.data.set('job.id', runtime.resolve('$input.job.id'))
    runtime.emit({ type: 'job.selected', payload: runtime.data.get('job.id') })
    runtime.patch('patch-1')

    assert.equal(runtime.get('user.name'), 'Ada')
    assert.equal(runtime.get('user.profile.title'), 'Engineer')
    assert.equal(runtime.get(''), state.context)
    assert.equal(runtime.get('user{name}'), 'Ada')
    assert.deepEqual(runtime.get('user{name,profile}'), { name: 'Ada', profile: { title: 'Engineer' } })
    assert.deepEqual(runtime.get('user{*}'), ['name', 'profile'])
    assert.deepEqual(state.context, { user: { name: 'Ada', profile: { title: 'Engineer' } } })
    assert.equal(runtime.data.get('job.id'), 'job-1')
    runtime.data.set('jobs[1].id', 'job-2')
    assert.equal(runtime.data.get('jobs.length'), 2)
    assert.equal(runtime.data.get('jobs[1].id'), 'job-2')
    assert.equal(runtime.data.get('jobs[0].id'), undefined)
    assert.deepEqual(state.events, [{ type: 'job.selected', payload: 'job-1' }])
    assert.deepEqual(state.patches, ['patch-1'])
    assert.deepEqual(runtime.stop('done'), { type: 'stop', reason: 'done' })
    assert.deepEqual(runtime.fail('failed', { id: 'job-1' }), {
      type: 'fail',
      reason: 'failed',
      data: { id: 'job-1' },
    })
    state.context = { user: { name: 'Grace' } }
    state.data = { count: 2 }
    assert.equal(runtime.get('user.name'), 'Grace')
    assert.equal(runtime.data.get('count'), 2)
    state.closed = true
    runtime.data.set('count', 3)
    assert.equal(runtime.data.get('count'), 2)
  })

  it('keeps deprecated runtime setData with a warning and removes getData', () => {
    const state: RunState<Ctx, string> = {
      context: { user: { name: 'Ada' } },
      input: {},
      data: {},
      patches: [],
      events: [],
      stepCounter: { current: 0 },
      startedAt: Date.now(),
      sync: false,
      signal: new AbortController().signal,
      abort: () => undefined,
      closed: false,
      reportedErrors: [],
      variables: {},
      expressions: {},
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const runtime = createRuntime(state)

    runtime.setData('job.id', 'job-1')

    assert.equal(runtime.data.get('job.id'), 'job-1')
    assert.equal(Object.hasOwn(runtime, 'getData'), false)
    expect(warn).toHaveBeenNthCalledWith(1, 'runtime.setData() is deprecated; use runtime.data.set() instead')
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('trace and safety limits', () => {
  it('reads data snapshots only with a trace sink', () => {
    for (const trace of [false, true, { push: () => undefined }]) {
      let reads = 0
      const data = {
        get value() {
          reads += 1
          return 7
        },
      }
      const runner = createRunner<{}>({ trace, mergeData: (_current, next) => next })
      let result: ReturnType<typeof runner.runSync>

      runner.registerAction('provide-data', () => ({ data }))
      runner.loadConfig({
        strategies: {
          root: { fn: 'provide-data', then: ['child'] },
          child: { fn: 'core.noop' },
        },
      })
      result = runner.runSync('root', {})

      assert.equal(result.status, 'success')
      if (trace === false) {
        assert.equal(reads, 0)
        assert.equal('timings' in result, false)
      } else {
        assert.ok(reads > 0)
        if (trace === true) {
          assert.deepEqual(result.trace?.[0]?.dataBefore, {})
          assert.deepEqual(result.trace?.[0]?.dataAfter, { value: 7 })
          assert.deepEqual(result.trace?.[1]?.dataBefore, { value: 7 })
          assert.deepEqual(result.trace?.[1]?.dataAfter, { value: 7 })
        }
      }
    }
  })

  it('does not return trace by default and returns memory trace when enabled', async () => {
    const withoutTrace = createRunner<Ctx>()
    withoutTrace.loadConfig({ strategies: { root: { fn: 'core.noop' } } })

    assert.equal((await withoutTrace.run('root', {})).trace, undefined)

    const withTrace = createRunner<Ctx>({ trace: true })
    withTrace.loadConfig({ strategies: { root: { fn: 'core.set', props: { path: 'seen', value: true } } } })

    const result = await withTrace.run('root', {})

    assert.equal(result.trace?.length, 1)
    assert.deepEqual(
      {
        step: result.trace?.[0]?.step,
        depth: result.trace?.[0]?.depth,
        strategy: result.trace?.[0]?.strategy,
        fn: result.trace?.[0]?.fn,
        status: result.trace?.[0]?.status,
        dataBefore: result.trace?.[0]?.dataBefore,
        dataAfter: result.trace?.[0]?.dataAfter,
      },
      {
        step: 1,
        depth: 0,
        strategy: 'root',
        fn: 'core.set',
        status: 'success',
        dataBefore: {},
        dataAfter: {},
      }
    )
    assert.equal(result.context.seen, true)
  })

  it('pushes trace entries into a custom trace sink', async () => {
    const entries: TraceEntry[] = []
    const runner = createRunner<Ctx>({
      trace: {
        push: (entry) => entries.push(entry),
        entries: () => entries,
      },
    })

    runner.loadConfig({ strategies: { root: { fn: 'core.noop' } } })

    const result = await runner.run('root', {})

    assert.equal(result.trace, entries)
    assert.equal(entries[0]?.strategy, 'root')
  })

  it('creates an isolated memory trace sink', () => {
    const sink = createMemoryTraceSink()

    sink.push({
      step: 1,
      depth: 0,
      strategy: 'root',
      fn: 'core.noop',
      mode: undefined,
      status: 'success',
      input: {},
      props: {},
      dataBefore: {},
      dataAfter: {},
      durationMs: 0,
    })

    assert.equal(sink.entries?.().length, 1)
  })

  it('returns limit errors for maxDepth and timeout', async () => {
    const depthRunner = createRunner<Ctx>({ maxDepth: 0 })
    depthRunner.loadConfig({
      strategies: {
        root: { fn: 'core.noop', then: ['next'] },
        next: { fn: 'core.noop' },
      },
    })

    assert.equal((await depthRunner.run('root', {})).error?.code, 'MAX_DEPTH')

    const timeoutRunner = createRunner<Ctx>({ timeout: 1 })
    timeoutRunner.registerAction('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    timeoutRunner.loadConfig({
      strategies: {
        root: { fn: 'slow' },
      },
    })

    const timeoutResult = await timeoutRunner.run('root', {})

    assert.equal(timeoutResult.error?.code, 'TIMEOUT')
  })

  it('keeps timeoutMs as a deprecated fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const runner = createRunner<Ctx>({ timeoutMs: 1 })
    runner.registerAction('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    runner.loadConfig({ strategies: { root: { fn: 'slow' } } })

    const result = await runner.run('root', {})

    assert.equal(result.error?.code, 'TIMEOUT')
    expect(warn).toHaveBeenCalledWith(
      'timeoutMs is deprecated; use timeout. It will be removed in a future major release.'
    )
    warn.mockRestore()
  })

  it('aborts timed-out actions and ignores their late runtime mutations', async () => {
    const runner = createRunner<Ctx, string>({ timeout: 1 })
    let aborted = false
    runner.registerAction(
      'slow',
      ({ runtime, signal }) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              runtime.data.set('late', true)
              runtime.patch('late')
              resolve()
            },
            { once: true }
          )
        })
    )
    runner.loadConfig({ strategies: { root: { fn: 'slow', then: ['next'] }, next: { fn: 'core.patch' } } })

    const result = await runner.run('root', {})

    assert.equal(result.error?.code, 'TIMEOUT')
    assert.equal(aborted, true)
    assert.deepEqual(result.data, {})
    assert.deepEqual(result.patches, [])
  })

  it('allows step-count and depth checks to be disabled', async () => {
    const runner = createRunner<Ctx>({ maxStepCount: -1, maxDepth: -1 })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.noop', then: ['next'] },
        next: { fn: 'core.noop', then: ['last'] },
        last: { fn: 'core.noop' },
      },
    })

    const result = await runner.run('root', {})

    assert.equal(result.status, 'success')
    assert.equal(result.steps, 3)
  })
})

describe('strategy timings', () => {
  it('records a synchronous tree in completion order and keeps run state shared', () => {
    const runner = createRunner<{ count: number }>({ trace: true })
    let result: ReturnType<typeof runner.runSync>
    let spans: StrategyTiming[]
    let root: StrategyTiming | undefined

    runner.registerAction('increment', ({ context, runtime }) => {
      context.count += 1
      runtime.data.set('count', context.count)
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.sequence', then: ['first', 'second'] },
        first: { fn: 'increment' },
        second: { fn: 'increment' },
      },
    })
    result = runner.runSync('root', { count: 0 })
    spans = result.timings ?? []
    root = spans.find(({ strategy }) => strategy === 'root')

    assert.equal(result.status, 'success')
    assert.equal('then' in result, false)
    assert.equal(result.context.count, 2)
    assert.equal(result.data.count, 2)
    assert.deepEqual(
      spans.map(({ strategy }) => strategy),
      ['first', 'second', 'root']
    )
    assert.ok(root)
    assert.equal(root.parentInvocationId, null)
    assert.equal(root.depth, 0)
    assert.equal(new Set(spans.map(({ invocationId }) => invocationId)).size, 3)
    for (const span of spans) {
      assert.ok(Number.isFinite(span.durationMs) && span.durationMs >= 0)
      assert.ok(Number.isFinite(span.startedAtMs) && span.startedAtMs >= 0)
      assert.equal(span.status, 'success')
      assert.deepEqual(
        Object.keys(span).sort(),
        ['invocationId', 'parentInvocationId', 'strategy', 'depth', 'startedAtMs', 'durationMs', 'status'].sort()
      )
      if (span.strategy !== 'root') {
        assert.equal(span.parentInvocationId, root.invocationId)
        assert.equal(span.depth, 1)
      }
    }
    assert.deepEqual(
      result.trace?.map(({ strategy }) => strategy),
      ['root', 'first', 'second']
    )
  })

  it('finishes the async parent after its controlled child', async () => {
    let release: () => void = () => undefined
    let finished = false
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const spans: StrategyTiming[] = []
    const runner = createRunner<{}>({
      trace: {
        push: () => undefined,
        pushTiming: (entry) => {
          spans.push(entry)
        },
      },
    })
    let pending: ReturnType<typeof runner.run>
    let result: Awaited<ReturnType<typeof runner.run>>

    runner.registerAction('wait', async () => {
      await gate
    })
    runner.loadConfig({ strategies: { root: { fn: 'core.noop', then: ['child'] }, child: { fn: 'wait' } } })
    pending = runner.run('root', {})
    void pending.then(() => {
      finished = true
    })
    await Promise.resolve()
    assert.equal(finished, false)
    assert.equal(spans.length, 0)
    release()
    result = await pending
    assert.deepEqual(
      spans.map(({ strategy }) => strategy),
      ['child', 'root']
    )
    assert.deepEqual(result.timings, spans)
    assert.ok(spans[1]!.durationMs >= spans[0]!.durationMs)
    assert.equal(spans[0]!.parentInvocationId, spans[1]!.invocationId)
  })

  it('keeps overlapping parallel children under one parent', async () => {
    let releaseFirst: () => void = () => undefined
    let releaseSecond: () => void = () => undefined
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    const started: string[] = []
    const runner = createRunner<{}>({ trace: true })
    let pending: ReturnType<typeof runner.run>
    let result: Awaited<ReturnType<typeof runner.run>>
    let spans: StrategyTiming[]
    let root: StrategyTiming | undefined

    runner.registerAction('first', async () => {
      started.push('first')
      await first
    })
    runner.registerAction('second', async () => {
      started.push('second')
      await second
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.parallel', mode: 'parallel', then: ['first', 'second'] },
        first: { fn: 'first' },
        second: { fn: 'second' },
      },
    })
    pending = runner.run('root', {})
    assert.deepEqual(started, ['first', 'second'])
    releaseSecond()
    await second
    releaseFirst()
    result = await pending
    spans = result.timings ?? []
    root = spans.find(({ strategy }) => strategy === 'root')

    assert.ok(root)
    assert.equal(spans.length, 3)
    assert.equal(spans.filter(({ parentInvocationId }) => parentInvocationId === null).length, 1)
    for (const span of spans) {
      if (span.strategy !== 'root') {
        assert.equal(span.parentInvocationId, root.invocationId)
      }
    }
  })

  it('times skipped calls and absent when, but not rejected transitions', () => {
    const runner = createRunner<{}>({ trace: true })
    let skipped: ReturnType<typeof runner.runSync>
    let absent: ReturnType<typeof runner.runSync>
    let transition: ReturnType<typeof runner.runSync>

    runner.loadConfig({
      strategies: {
        skipped: { fn: 'core.noop', when: false },
        absent: { fn: 'core.noop' },
        transition: { fn: 'core.noop', then: [{ strategy: 'absent', when: ['truthy', false] }] },
      },
    })
    skipped = runner.runSync('skipped', {})
    absent = runner.runSync('absent', {})
    transition = runner.runSync('transition', {})
    assert.equal(skipped.timings?.[0]?.status, 'skipped')
    assert.equal(absent.timings?.[0]?.status, 'success')
    assert.deepEqual(
      transition.timings?.map(({ strategy }) => strategy),
      ['transition']
    )
    assert.equal(absent.timings?.[0]?.invocationId, 1)
  })

  it('keeps throw/catch and stopped outcomes without duplicate spans', () => {
    const runner = createRunner<{}>({ trace: true })
    let recovered: ReturnType<typeof runner.runSync>
    let failed: ReturnType<typeof runner.runSync>
    let stopped: ReturnType<typeof runner.runSync>

    runner.registerAction('throw', () => {
      throw new Error('action failure')
    })
    runner.loadConfig({
      strategies: {
        recovered: { fn: 'throw', catch: ['fallback'] },
        fallback: { fn: 'core.noop' },
        failed: { fn: 'throw' },
        stopped: { fn: 'core.stop' },
      },
    })
    recovered = runner.runSync('recovered', {})
    failed = runner.runSync('failed', {})
    stopped = runner.runSync('stopped', {})
    assert.equal(recovered.status, 'success')
    assert.deepEqual(
      recovered.timings?.map(({ strategy }) => strategy),
      ['fallback', 'recovered']
    )
    assert.equal(recovered.timings?.[0]?.parentInvocationId, recovered.timings?.[1]?.invocationId)
    assert.equal(failed.error?.code, 'ACTION_THROWN')
    assert.equal(failed.timings?.length, 1)
    assert.equal(failed.timings?.[0]?.status, 'failed')
    assert.equal(stopped.timings?.[0]?.status, 'stopped')
  })

  it('finalizes a timeout once without waiting for the action to settle', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const spans: StrategyTiming[] = []
    const runner = createRunner<{}>({
      timeout: 20,
      trace: {
        push: () => undefined,
        pushTiming: (entry) => {
          spans.push(entry)
        },
      },
    })
    let result: Awaited<ReturnType<typeof runner.run>>

    runner.registerAction('wait', async () => {
      await gate
    })
    runner.loadConfig({ strategies: { root: { fn: 'wait' } } })
    result = await runner.run('root', {})
    assert.equal(result.error?.code, 'TIMEOUT')
    assert.equal(spans.length, 1)
    assert.equal(spans[0]?.status, 'failed')
    release()
    await gate
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    assert.equal(spans.length, 1)
  })

  it('keeps async-in-sync failures synchronous and records one failed span', () => {
    const spans: StrategyTiming[] = []
    const runner = createRunner<{}>({
      trace: {
        push: () => undefined,
        pushTiming: (entry) => {
          spans.push(entry)
        },
      },
    })

    runner.registerAction('async', async () => undefined)
    runner.loadConfig({ strategies: { root: { fn: 'async' } } })
    assert.throws(() => runner.runSync('root', {}), /returned a Promise/)
    assert.equal(spans.length, 1)
    assert.equal(spans[0]?.status, 'failed')
  })

  it('supports old sinks and emits the same timings to a new sink', () => {
    const spans: StrategyTiming[] = []
    const old = createRunner<{}>({ trace: { push: () => undefined } })
    const runner = createRunner<{}>({
      trace: {
        push: () => undefined,
        pushTiming: (entry) => {
          spans.push(entry)
        },
      },
    })
    const config: Config = { strategies: { root: { fn: 'core.noop' } } }
    let result: ReturnType<typeof runner.runSync>

    old.loadConfig(config)
    runner.loadConfig(config)
    assert.equal(old.runSync('root', {}).timings?.length, 1)
    result = runner.runSync('root', {})
    assert.deepEqual(result.timings, spans)
  })

  it('propagates timing sink exceptions without action errors, retry or duplicate spans', async () => {
    for (const async of [false, true]) {
      for (const rootFn of ['core.noop', 'core.loop']) {
        const failure = new Error('timing sink failure')
        const laterFailure = new Error('ancestor timing sink failure')
        const spans: StrategyTiming[] = []
        const errors: unknown[] = []
        const context = { calls: 0, catches: 0 }
        const source = new AbortController()
        let capturedRuntime: Runtime | undefined
        const runner = createRunner<typeof context>({
          onError: (error) => {
            errors.push(error)
          },
          trace: {
            push: () => undefined,
            pushTiming: (entry) => {
              spans.push(entry)
              throw spans.length === 1 ? failure : laterFailure
            },
          },
        })
        const action = ({ context, runtime }: ActionArgs<TimingContext>) => {
          capturedRuntime = runtime
          context.calls += 1
        }

        runner.registerAction('child', async ? async (args) => action(args) : action)
        runner.registerAction('caught', ({ context }) => {
          context.catches += 1
        })
        runner.loadConfig({
          strategies: {
            root: {
              fn: rootFn,
              props: rootFn === 'core.loop' ? { max: 1, duration: 1, immediate: true } : {},
              then: ['child'],
              catch: ['caught'],
            },
            child: { fn: 'child', catch: ['caught'] },
            caught: { fn: 'caught' },
          },
        })
        if (async || rootFn === 'core.loop') {
          await assert.rejects(runner.run('root', context, {}, { signal: source.signal }), (cause) => cause === failure)
        } else {
          assert.throws(
            () => runner.runSync('root', context, {}, { signal: source.signal }),
            (cause) => cause === failure
          )
        }
        assert.ok(capturedRuntime)
        capturedRuntime.set('calls', 42)
        capturedRuntime.data.set('late', true)
        assert.equal(capturedRuntime.data.get('late'), undefined)
        assert.equal((await capturedRuntime.executeThen()).status, 'stopped')
        assert.equal(await capturedRuntime.executeCatch(), undefined)
        source.abort()
        assert.equal(capturedRuntime.signal.aborted, false)
        assert.deepEqual(context, { calls: 1, catches: 0 })
        assert.deepEqual(errors, [])
        assert.deepEqual(
          spans.map(({ strategy }) => strategy),
          ['child', 'root']
        )
        assert.equal(spans[0]?.status, 'success')
        assert.equal(spans[1]?.status, 'failed')
      }
    }
  })

  it('preserves original thrown and rejected errors if finalizing also throws', async () => {
    for (const async of [false, true]) {
      for (const entrypoint of ['child', 'parent']) {
        const failure = new Error('original run failure')
        const spans: StrategyTiming[] = []
        const runner = createRunner<{}>({
          onError: () => {
            throw failure
          },
          trace: {
            push: () => undefined,
            pushTiming: (entry) => {
              spans.push(entry)
              throw new Error('sink failure')
            },
          },
        })

        runner.registerAction(
          'throw',
          async
            ? async () => {
                throw new Error('action failure')
              }
            : () => {
                throw new Error('action failure')
              }
        )
        runner.loadConfig({ strategies: { parent: { fn: 'core.noop', then: ['child'] }, child: { fn: 'throw' } } })
        if (async) {
          await assert.rejects(runner.run(entrypoint, {}), (cause) => cause === failure)
        } else {
          assert.throws(
            () => runner.runSync(entrypoint, {}),
            (cause) => cause === failure
          )
        }
        assert.deepEqual(
          spans.map(({ strategy }) => strategy),
          entrypoint === 'child' ? ['child'] : ['child', 'parent']
        )
        assert.ok(spans.every(({ status }) => status === 'failed'))
      }
    }
  })

  it('preserves the existing push exception policy', () => {
    const failure = new Error('existing trace sink failure')
    const runner = createRunner<{}>({
      trace: {
        push: () => {
          throw failure
        },
      },
    })
    let result: ReturnType<typeof runner.runSync>

    runner.loadConfig({ strategies: { root: { fn: 'core.noop' } } })
    result = runner.runSync('root', {})
    assert.equal(result.error?.code, 'ACTION_THROWN')
    assert.equal(result.error?.cause, failure)
  })
})

describe('per-invocation runtime', () => {
  it('keeps the runtime used by a condition available to its action and closes retained helpers', async () => {
    const captured: Runtime[] = []
    const conditionRuntimes: unknown[] = []
    const runner = createRunner<{ count: number }>()
    let result: Awaited<ReturnType<typeof runner.run>>

    runner.registerCondition('capture-runtime', ({ runtime }) => {
      conditionRuntimes.push(runtime)
      runtime.data.set('condition', true)
      return true
    })
    runner.registerAction('use-runtime', ({ runtime, context }) => {
      captured.push(runtime)
      assert.equal(runtime, conditionRuntimes[conditionRuntimes.length - 1])
      assert.equal(runtime.data.get('condition'), true)
      context.count += 1
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.noop', then: ['child', 'child'] },
        child: { fn: 'use-runtime', when: ['capture-runtime'] },
      },
    })
    result = await runner.run('root', { count: 0 })
    assert.equal(result.context.count, 2)
    assert.notEqual(captured[0], captured[1])
    captured[0]!.set('count', 99)
    captured[0]!.data.set('late', true)
    captured[0]!.emit({ type: 'late' })
    captured[0]!.patch('late')
    assert.equal(result.context.count, 2)
    assert.equal(result.data.late, undefined)
    assert.deepEqual(result.events, [])
    assert.deepEqual(result.patches, [])
    assert.deepEqual(await captured[0]!.executeThen(), { status: 'stopped', reason: 'Run is already finished' })
    assert.equal(await captured[0]!.executeCatch(), undefined)
  })
})

describe('runner config snapshots and condition validation cache', () => {
  it('applies source config changes only after reloading without freezing the caller', () => {
    const runner = createRunner<{}>()
    const when: ConditionExpression = ['eq', '$input.value', 1]
    const literal = { value: 1 }
    const then = ['finish']
    const config: Config = {
      strategies: {
        root: { fn: 'capture', when, props: { literal }, then },
        finish: { fn: 'finish' },
        different: { fn: 'different' },
      },
    }
    let before: ReturnType<typeof runner.runSync>
    let after: ReturnType<typeof runner.runSync>

    runner.registerAction('capture', ({ props: { literal } }) => ({ data: { literal } }))
    runner.registerAction('finish', () => ({ data: { finished: 'original' } }))
    runner.registerAction('different', () => ({ data: { finished: 'updated' } }))
    assert.equal(runner.loadConfig(config).ok, true)
    assert.equal(runner.runSync('root', {}, { value: 1 }).status, 'success')
    when[2] = 2
    literal.value = 2
    then[0] = 'different'
    before = runner.runSync('root', {}, { value: 1 })
    assert.equal(before.status, 'success')
    assert.deepEqual(before.data, { literal: { value: 1 }, finished: 'original' })
    assert.equal(Object.isFrozen(config), false)
    assert.equal(Object.isFrozen(when), false)
    assert.equal(Object.isFrozen(literal), false)
    assert.equal(runner.loadConfig(config).ok, true)
    after = runner.runSync('root', {}, { value: 2 })
    assert.equal(after.status, 'success')
    assert.deepEqual(after.data, { literal: { value: 2 }, finished: 'updated' })
    assert.equal(runner.runSync('root', {}, { value: 1 }).status, 'skipped')
  })

  it('keeps dynamically registered conditions and actions live after warmup', () => {
    const runner = createRunner<{}>()

    runner.registerCondition('custom', () => false)
    runner.registerAction('write', () => ({ data: { version: 1 } }))
    runner.loadConfig({ strategies: { root: { fn: 'write', when: ['custom'] } } })
    assert.equal(runner.runSync('root', {}).status, 'skipped')
    runner.registerCondition('custom', () => true)
    assert.equal(runner.runSync('root', {}).data.version, 1)
    runner.registerAction('write', () => ({ data: { version: 2 } }))
    assert.equal(runner.runSync('root', {}).data.version, 2)
  })

  it('preserves invalid config run diagnostics and later condition registration', () => {
    const runner = createRunner<{}>()
    const when: ConditionExpression = ['missing-condition']
    let first: ReturnType<typeof runner.runSync>
    let second: ReturnType<typeof runner.runSync>

    assert.equal(
      runner.loadConfig({
        strategies: {
          first: { fn: 'core.noop', when },
          second: { fn: 'core.noop', when },
        },
      }).ok,
      false
    )
    first = runner.runSync('first', {})
    second = runner.runSync('second', {})
    assert.equal(first.error?.code, 'CONDITION_NOT_FOUND')
    assert.equal(second.error?.code, 'CONDITION_NOT_FOUND')
    assert.equal(first.error?.strategy, 'first')
    assert.equal(second.error?.strategy, 'second')
    assert.match(first.error?.path ?? '', /first/)
    assert.match(second.error?.path ?? '', /second/)
    runner.registerCondition('missing-condition', () => true)
    assert.equal(runner.runSync('first', {}).status, 'success')
    assert.equal(runner.runSync('second', {}).status, 'success')
  })

  it('checks current input types and expression results after validation is cached', () => {
    const expressions = { current: () => 1 }
    const runner = createRunner<{}>({ expressions })
    let typed: ReturnType<typeof runner.runSync>

    runner.loadConfig({
      types: { value: 'number' },
      strategies: {
        root: { fn: 'core.noop', when: ['and', ['gt', '$input.value', 0], ['eq', { $expression: ['current'] }, 1]] },
      },
    })
    assert.equal(runner.runSync('root', {}, { value: 1 }).status, 'success')
    typed = runner.runSync('root', {}, { value: 'wrong' })
    assert.equal(typed.error?.code, 'TYPE_MISMATCH')
    assert.equal(runner.runSync('root', {}, { value: 2 }).status, 'success')
    expressions.current = () => 2
    assert.equal(runner.runSync('root', {}, { value: 2 }).status, 'skipped')
  })

  it('snapshots literal prototype keys, sparse arrays and function values', () => {
    const runner = createRunner<{}>()
    const items = new Array(3)
    const fn = () => 7
    const literal = { ['__proto__']: { safe: true } }
    let result: ReturnType<typeof runner.runSync>

    items[1] = 7
    runner.registerAction('capture', ({ props }) => ({ data: { ...props } }))
    runner.loadConfig({ strategies: { root: { fn: 'capture', props: { items, fn, literal } } } })
    items[1] = 99
    literal.__proto__.safe = false
    result = runner.runSync('root', {})
    assert.equal(result.data.fn, fn)
    assert.ok(Array.isArray(result.data.items))
    assert.equal(result.data.items.length, 3)
    assert.equal(0 in result.data.items, false)
    assert.equal(result.data.items[1], 7)
    assert.deepEqual(result.data.literal, { ['__proto__']: { safe: true } })
    assert.equal(Object.getPrototypeOf(result.data.literal), Object.prototype)
  })

  it('keeps public evaluation validating mutable arguments after warmup', () => {
    const expression: ConditionExpression = ['eq', 1, 1]
    let result: ReturnType<typeof evaluateCondition>

    assert.deepEqual(evaluateCondition(expression, { context: {} }), { ok: true, matched: true })
    expression[0] = 'unregistered'
    result = evaluateCondition(expression, { context: {} })
    assert.equal(result.ok, false)
    if (result.ok === false) {
      assert.equal(result.error.code, 'CONDITION_NOT_FOUND')
    }
  })
})

describe('private condition validation reuse', () => {
  it('validates a frozen expression once but evaluates current values on every call', () => {
    let checks = 0
    const conditions = new Map<string, () => boolean>([['custom', () => true]])
    const has = conditions.has.bind(conditions)
    const validatedConditions = new WeakSet<object>()
    const expression = Object.freeze(['custom'])

    conditions.has = (name) => {
      checks += 1
      return has(name)
    }
    assert.deepEqual(evaluateConditionWithRegistry(expression, { context: {} }, { conditions }, validatedConditions), {
      ok: true,
      matched: true,
    })
    assert.equal(checks, 1)
    conditions.set('custom', () => false)
    assert.deepEqual(evaluateConditionWithRegistry(expression, { context: {} }, { conditions }, validatedConditions), {
      ok: true,
      matched: false,
    })
    assert.equal(checks, 1)
    assert.deepEqual(
      evaluateConditionWithRegistry(expression, { context: {} }, { conditions }, new WeakSet<object>()),
      { ok: true, matched: false }
    )
    assert.equal(checks, 2)
  })
})

describe('owned type declarations', () => {
  it('protects retained custom-condition types while keeping caller types mutable', () => {
    const types: TypeRules = { value: ['number', 'undefined'] }
    const runner = createRunner<{}>()

    runner.registerCondition('inspect-types', ({ types }) => {
      assert.ok(Object.isFrozen(types))
      if (types !== undefined) {
        const { value } = types

        assert.equal(Reflect.set(types, 'value', 'string'), false)
        if (Array.isArray(value)) {
          assert.ok(Object.isFrozen(value))
          assert.equal(Reflect.set(value, '0', 'string'), false)
        }
      }

      return true
    })
    runner.loadConfig({
      types,
      strategies: { root: { fn: 'core.noop', when: ['and', ['inspect-types'], ['gt', '$input.value', 0]] } },
    })
    types.value = 'string'
    assert.equal(Object.isFrozen(types), false)
    assert.equal(runner.runSync('root', {}, { value: 1 }).status, 'success')
    assert.equal(runner.runSync('root', {}, { value: 'wrong' }).error?.code, 'TYPE_MISMATCH')
  })
})
