import assert from 'node:assert/strict'
import { describe, expect, it, vi } from 'vitest'
import { createRunner } from '~/runner'
import { createMemoryTraceSink, type Config } from '~/index'
import { createRuntime } from '~/helpers/runner/createRuntime'
import { type RunState } from '~/helpers/runner/runnerTypes'
import { type TraceEntry } from '~/types'

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
    assert.deepEqual(state.context, { user: { name: 'Ada', profile: { title: 'Engineer' } } })
    assert.equal(runtime.data.get('job.id'), 'job-1')
    assert.deepEqual(state.events, [{ type: 'job.selected', payload: 'job-1' }])
    assert.deepEqual(state.patches, ['patch-1'])
    assert.deepEqual(runtime.stop('done'), { type: 'stop', reason: 'done' })
    assert.deepEqual(runtime.fail('failed', { id: 'job-1' }), {
      type: 'fail',
      reason: 'failed',
      data: { id: 'job-1' },
    })
  })

  it('keeps deprecated runtime data methods with warnings', () => {
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

    assert.equal(runtime.getData('job.id'), 'job-1')
    expect(warn).toHaveBeenNthCalledWith(1, 'runtime.setData() is deprecated; use runtime.data.set() instead')
    expect(warn).toHaveBeenNthCalledWith(2, 'runtime.getData() is deprecated; use runtime.data.get() instead')
    warn.mockRestore()
  })
})

describe('trace and safety limits', () => {
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
