import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/createRunner'
import { createFlow } from '~/createFlow'
import { createPubSub } from '~/createPubSub'

describe('guards', () => {
  it('substitutes the guard expression into the strategy, not the reference', () => {
    const runner = createRunner()
    const config = {
      guards: { 'colony-ready': ['truthy', '$data.colonyId'] as ['truthy', string] },
      strategies: {
        root: { fn: 'core.noop', when: ['guard', 'colony-ready'] as ['guard', string] },
      },
    }

    const validation = runner.loadConfig(config)

    assert.equal(validation.ok, true)
    assert.deepEqual(validation.errors, [])
  })

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
})
