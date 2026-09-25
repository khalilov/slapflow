import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/createRunner'
import { resolveGuards } from '~/helpers/validation/resolveGuards'
import { defineErrorReporter, type SlapErrorEvent } from '~/index'

type Ctx = Record<string, unknown>

describe('ensure condition', () => {
  it('requires catch when used as the root when operator', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      strategies: { root: { fn: 'core.noop', when: ['ensure', ['exists', '$data.sessionId']] } },
    })

    assert.equal(result.ok, false)
    assert.equal(
      result.errors.some(({ code }) => code === 'ENSURE_WITHOUT_CATCH'),
      true
    )
  })

  it('rejects ensure nested inside other condition operators', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      strategies: {
        root: {
          fn: 'core.noop',
          when: ['and', ['ensure', ['exists', '$data.sessionId']], true],
          catch: ['next'],
        },
        next: { fn: 'core.noop' },
      },
    })

    assert.equal(result.ok, false)
    assert.equal(
      result.errors.some(({ code }) => code === 'ENSURE_PLACEMENT_INVALID'),
      true
    )
  })

  it('rejects ensure in an inline next condition', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      strategies: {
        root: { fn: 'core.noop', then: [{ strategy: 'next', when: ['ensure', ['exists', '$data.sessionId']] }] },
        next: { fn: 'core.noop' },
      },
    })

    assert.equal(result.ok, false)
    assert.equal(
      result.errors.some(({ code }) => code === 'ENSURE_PLACEMENT_INVALID'),
      true
    )
  })

  it('accepts ensure with catch and through a guard root', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      guards: { 'has-session': ['ensure', ['exists', '$input.sessionId']] },
      strategies: {
        root: { fn: 'core.noop', when: ['guard', 'has-session'], catch: ['next'] },
        next: { fn: 'core.noop' },
      },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.errors, [])
  })

  it('routes a failed ensure into catch without reporting onError', async () => {
    const reports: SlapErrorEvent<Ctx>[] = []
    const runner = createRunner<Ctx>({ onError: defineErrorReporter((event) => reports.push(event)) })

    runner.loadConfig({
      strategies: {
        root: {
          fn: 'core.noop',
          when: ['ensure', ['exists', '$input.sessionId']],
          then: ['load'],
          catch: ['require'],
        },
        load: { fn: 'core.patch', props: { patch: 'loaded' } },
        require: { fn: 'core.patch', props: { patch: 'required' } },
      },
    })

    const result = await runner.run('root', {})

    assert.equal(result.status, 'success')
    assert.deepEqual(result.patches, ['required'])
    assert.equal(reports.length, 0)
  })

  it('proceeds normally when the ensure condition matches', async () => {
    const runner = createRunner<Ctx>()

    runner.loadConfig({
      strategies: {
        root: {
          fn: 'core.noop',
          when: ['ensure', ['exists', '$input.sessionId']],
          then: ['load'],
          catch: ['require'],
        },
        load: { fn: 'core.patch', props: { patch: 'loaded' } },
        require: { fn: 'core.patch', props: { patch: 'required' } },
      },
    })

    const result = await runner.run('root', {}, { sessionId: 'abc' })

    assert.equal(result.status, 'success')
    assert.deepEqual(result.patches, ['loaded'])
  })

  it('reports loudly when the catch branch itself fails', async () => {
    const reports: SlapErrorEvent<Ctx>[] = []
    const runner = createRunner<Ctx>({ onError: defineErrorReporter((event) => reports.push(event)) })

    runner.registerAction('boom', () => {
      throw new Error('boom')
    })
    runner.loadConfig({
      strategies: {
        root: { fn: 'core.noop', when: ['ensure', ['exists', '$data.sessionId']], catch: ['boom'] },
        boom: { fn: 'boom' },
      },
    })

    const result = await runner.run('root', {})

    assert.equal(result.status, 'failed')
    assert.equal(
      reports.some(({ error }) => error.code === 'ACTION_THROWN'),
      true
    )
  })

  it('reports resolution errors under ensure as real failures', async () => {
    const reports: SlapErrorEvent<Ctx>[] = []
    const runner = createRunner<Ctx>({ onError: defineErrorReporter((event) => reports.push(event)) })

    runner.loadConfig({
      strategies: {
        root: {
          fn: 'core.noop',
          when: ['ensure', ['eq', '$variables.MISSING', 1]],
          then: ['load'],
          catch: ['require'],
        },
        load: { fn: 'core.patch', props: { patch: 'loaded' } },
        require: { fn: 'core.patch', props: { patch: 'required' } },
      },
    })

    const result = await runner.run('root', {})

    assert.equal(result.status, 'success')
    assert.deepEqual(result.patches, ['required'])
    assert.equal(reports.length, 1)
    assert.equal(reports[0]?.error.code, 'VARIABLE_NOT_FOUND')
  })

  it('marks the trace entry as failed when ensure does not match', async () => {
    const runner = createRunner<Ctx>({ trace: true })

    runner.loadConfig({
      strategies: {
        root: {
          fn: 'core.noop',
          when: ['ensure', ['exists', '$data.sessionId']],
          catch: ['require'],
        },
        require: { fn: 'core.noop' },
      },
    })

    const result = await runner.run('root', {})
    const entry = result.trace?.find(({ strategy }) => strategy === 'root')

    assert.equal(entry?.status, 'failed')
    assert.equal(entry?.reason, 'ensure did not match')
  })

  it('expands a guard reference inside ensure and matches', async () => {
    const runner = createRunner<Ctx>()

    runner.loadConfig({
      guards: { 'session-ok': ['exists', '$input.sessionId'] },
      strategies: {
        root: {
          fn: 'core.noop',
          when: ['ensure', ['guard', 'session-ok']],
          then: ['load'],
          catch: ['require'],
        },
        load: { fn: 'core.patch', props: { patch: 'loaded' } },
        require: { fn: 'core.patch', props: { patch: 'required' } },
      },
    })

    const result = await runner.run('root', {}, { sessionId: 'abc' })

    assert.equal(result.status, 'success')
    assert.deepEqual(result.patches, ['loaded'])
  })

  it('routes a guard reference inside ensure into catch without reporting onError', async () => {
    const reports: SlapErrorEvent<Ctx>[] = []
    const runner = createRunner<Ctx>({ onError: defineErrorReporter((event) => reports.push(event)), trace: true })

    runner.loadConfig({
      guards: { 'session-ok': ['exists', '$input.sessionId'] },
      strategies: {
        root: {
          fn: 'core.noop',
          when: ['ensure', ['guard', 'session-ok']],
          then: ['load'],
          catch: ['require'],
        },
        load: { fn: 'core.patch', props: { patch: 'loaded' } },
        require: { fn: 'core.patch', props: { patch: 'required' } },
      },
    })

    const result = await runner.run('root', {})
    const entry = result.trace?.find(({ strategy }) => strategy === 'root')

    assert.equal(entry?.status, 'failed')
    assert.deepEqual(result.patches, ['required'])
    assert.equal(reports.length, 0)
  })

  it('expands a chain of guard references inside ensure', async () => {
    const runner = createRunner<Ctx>()

    runner.loadConfig({
      guards: {
        'level-two': ['exists', '$input.sessionId'],
        'level-one': ['guard', 'level-two'],
      },
      strategies: {
        root: {
          fn: 'core.noop',
          when: ['ensure', ['guard', 'level-one']],
          then: ['load'],
          catch: ['require'],
        },
        load: { fn: 'core.patch', props: { patch: 'loaded' } },
        require: { fn: 'core.patch', props: { patch: 'required' } },
      },
    })

    const result = await runner.run('root', {}, { sessionId: 'abc' })

    assert.equal(result.status, 'success')
    assert.deepEqual(result.patches, ['loaded'])
  })

  it('resolves props from the same path validated by ensure', async () => {
    let received: unknown
    const runner = createRunner<Ctx>()

    runner.registerAction('capture', ({ props }) => {
      received = props.sessionId
    })
    runner.loadConfig({
      strategies: {
        root: {
          fn: 'capture',
          when: ['ensure', ['exists', '$input.sessionId']],
          props: { sessionId: '$input.sessionId' },
          catch: ['require'],
        },
        require: { fn: 'core.noop' },
      },
    })

    await runner.run('root', {}, { sessionId: 'abc' })

    assert.equal(received, 'abc')
  })
})

describe('resolveGuards ensure expansion', () => {
  it('expands a guard reference inside ensure', () => {
    const { config, issues } = resolveGuards({
      guards: { 'session-ok': ['exists', '$input.sessionId'] },
      strategies: { root: { fn: 'core.noop', when: ['ensure', ['guard', 'session-ok']], catch: ['next'] } },
    })

    assert.deepEqual(issues, [])
    assert.deepEqual(config.strategies.root?.when, ['ensure', ['exists', '$input.sessionId']])
  })

  it('reports a missing guard referenced inside ensure', () => {
    const { issues } = resolveGuards({
      strategies: { root: { fn: 'core.noop', when: ['ensure', ['guard', 'missing']], catch: ['next'] } },
    })

    assert.equal(issues[0]?.code, 'GUARD_NOT_FOUND')
  })
})
