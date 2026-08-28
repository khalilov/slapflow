import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/runner'
import { defineErrorReporter, type SlapErrorEvent } from '~/index'

type Ctx = {
  user?: string
}

describe('error reporter', () => {
  it('reports thrown action errors with execution stage and runtime state', async () => {
    const reports: SlapErrorEvent<Ctx, string>[] = []
    const reporter = defineErrorReporter<Ctx, string>({
      report: (event) => reports.push(event),
    })
    const runner = createRunner<Ctx, string>({ onError: reporter, trace: true })

    runner.registerAction('boom', () => {
      throw new Error('boom')
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.set', props: { path: 'phase', value: 'before' }, then: ['boom'] },
        boom: { fn: 'boom' },
      },
    })

    const result = await runner.run('root', { user: 'Ada' }, { command: 'run' })

    assert.equal(result.status, 'failed')
    assert.equal(reports.length, 1)
    assert.deepEqual(
      {
        code: reports[0]?.error.code,
        strategy: reports[0]?.error.strategy,
        fn: reports[0]?.error.fn,
        phase: reports[0]?.error.stage?.phase,
        step: reports[0]?.error.stage?.step,
        depth: reports[0]?.error.stage?.depth,
        context: reports[0]?.context,
        input: reports[0]?.input,
        data: reports[0]?.data,
        traceLength: reports[0]?.trace?.length,
      },
      {
        code: 'ACTION_THROWN',
        strategy: 'boom',
        fn: 'boom',
        phase: 'action',
        step: 2,
        depth: 1,
        context: { user: 'Ada', phase: 'before' },
        input: { command: 'run' },
        data: {},
        traceLength: 1,
      }
    )
  })

  it('reports runtime.fail before catch recovery continues the chain', async () => {
    const reports: SlapErrorEvent<Ctx, string>[] = []
    const runner = createRunner<Ctx, string>({
      onError: defineErrorReporter((event) => reports.push(event)),
    })

    runner.loadConfig({
      strategies: {
        root: { fn: 'core.fail', props: { reason: 'blocked' }, catch: ['recover'] },
        recover: { fn: 'core.patch', props: { patch: 'recovered' } },
      },
    })

    const result = await runner.run('root', {})

    assert.equal(result.status, 'success')
    assert.deepEqual(result.patches, ['recovered'])
    assert.equal(reports.length, 1)
    assert.equal(reports[0]?.error.message, 'blocked')
    assert.deepEqual(reports[0]?.error.stage, {
      phase: 'action',
      strategy: 'root',
      fn: 'core.fail',
      step: 1,
      depth: 0,
    })
  })

  it('reports condition, entrypoint and limit phases', async () => {
    const reports: SlapErrorEvent<Ctx>[] = []
    const reporter = defineErrorReporter<Ctx>((event) => reports.push(event))

    const conditionRunner = createRunner<Ctx>({ onError: reporter })
    conditionRunner.loadConfig({ strategies: { root: { fn: 'core.noop', when: ['missing.condition'] } } })
    await conditionRunner.run('root', {})

    const entrypointRunner = createRunner<Ctx>({ onError: reporter })
    entrypointRunner.loadConfig({ strategies: { root: { fn: 'core.noop' } } })
    await entrypointRunner.run('missing', {})

    const limitRunner = createRunner<Ctx>({ onError: reporter, maxDepth: 0 })
    limitRunner.loadConfig({
      strategies: {
        root: { fn: 'core.noop', then: ['next'] },
        next: { fn: 'core.noop' },
      },
    })
    await limitRunner.run('root', {})

    assert.deepEqual(
      reports.map((event) => event.error.stage?.phase),
      ['condition', 'entrypoint', 'limit']
    )
  })
})
