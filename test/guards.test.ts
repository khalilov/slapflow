import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/createRunner'
import { createFlow } from '~/createFlow'
import { createPubSub } from '~/createPubSub'
import { type Config } from '~/types'

describe('guards', () => {
  it('reports a missing guard', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      strategies: { root: { fn: 'core.noop', when: ['guard', 'does-not-exist'] } },
    })

    assert.equal(result.ok, false)
    assert.equal(
      result.errors.some(({ code }) => code === 'GUARD_NOT_FOUND'),
      true
    )
  })

  it('reports a guard reference cycle', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      guards: { a: ['guard', 'b'], b: ['guard', 'a'] },
      strategies: { root: { fn: 'core.noop', when: ['guard', 'a'] } },
    })

    assert.equal(result.ok, false)
    assert.equal(
      result.errors.some(({ code }) => code === 'GUARD_CYCLE'),
      true
    )
  })

  it('nests guards inside and/or/not expressions', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      guards: {
        'has-colony': ['truthy', '$data.colonyId'],
        'same-colony': ['eq', '$input.colonyId', '$context.colonyId'],
      },
      strategies: {
        root: {
          fn: 'core.noop',
          when: ['and', ['guard', 'has-colony'], ['not', ['guard', 'same-colony']]],
        },
      },
    })

    assert.equal(result.ok, true)
  })

  it('evaluates a resolved guard through createFlow', async () => {
    type Context = { colonyId: string }
    type Events = { 'enter.colony': { colonyId: string } }

    const matched: string[] = []
    const bus = createPubSub<Events>()
    const flow = createFlow<Context, unknown, Events>(
      {
        actions: {
          'enter.apply': ({ input }) => {
            matched.push(input.colonyId as string)
          },
        },
        events: {
          '[bus] enter.colony': { entrypoint: 'enter.colony' },
        },
        config: {
          guards: {
            'same-colony': ['eq', '$input.colonyId', '$context.colonyId'],
          },
          entrypoints: { 'enter.colony': 'enter.apply' },
          strategies: {
            'enter.apply': { fn: 'enter.apply', when: ['guard', 'same-colony'], terminal: true },
          },
        },
      },
      { bus, context: { colonyId: 'colony-1' } }
    )

    flow.start()
    bus.emit('enter.colony', { colonyId: 'colony-1' })
    bus.emit('enter.colony', { colonyId: 'colony-2' })
    flow.stop()

    assert.deepEqual(matched, ['colony-1'])
  })

  it('keeps dotted strategy names, false guards and the supplied config intact', () => {
    const config: Config = {
      guards: { 'gate.closed': false, 'gate.open': true },
      entrypoints: { 'job.start': 'job.closed' },
      strategies: {
        'job.closed': { fn: 'core.patch', when: ['guard', 'gate.closed'], props: { patch: 'closed' } },
        'job.open': { fn: 'core.patch', when: ['guard', 'gate.open'], props: { patch: 'open' } },
      },
    }
    const original = structuredClone(config)
    const runner = createRunner()
    const validation = runner.loadConfig(config)
    const closed = runner.runSync('job.start', {})
    const open = runner.runSync('job.open', {})

    assert.equal(validation.ok, true)
    assert.equal(closed.status, 'skipped')
    assert.deepEqual(closed.patches, [])
    assert.equal(open.status, 'success')
    assert.deepEqual(open.patches, ['open'])
    assert.deepEqual(config, original)
  })

  it('evaluates a contains guard through the runner', async () => {
    const runner = createRunner()

    runner.loadConfig({
      guards: { 'claim-request-valid': ['contains', '$input', ['colonyId', 'requestId']] },
      strategies: {
        root: { fn: 'core.patch', props: { patch: 'claimed' }, when: ['guard', 'claim-request-valid'] },
      },
    })

    const claimed = await runner.run('root', {}, { colonyId: 'c-1', requestId: 'r-1' })
    const skipped = await runner.run('root', {}, { colonyId: 'c-1' })

    assert.equal(claimed.status, 'success')
    assert.deepEqual(claimed.patches, ['claimed'])
    assert.equal(skipped.status, 'skipped')
    assert.deepEqual(skipped.patches, [])
  })
})
