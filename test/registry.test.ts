import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/runner'
import { createActionsRegistry } from '~/registry/actions'
import { createConditionsRegistry } from '~/registry/conditions'
import { type Config } from '~/types'

type Ctx = {
  value?: number
}

describe('registry', () => {
  it('creates actions registry with every built-in action', () => {
    const registry = createActionsRegistry<Ctx, string>()

    assert.deepEqual([...registry.keys()].sort(), [
      'core.delay',
      'core.emit',
      'core.fail',
      'core.fetch',
      'core.loop',
      'core.noop',
      'core.parallel',
      'core.patch',
      'core.selector',
      'core.sequence',
      'core.set',
      'core.setData',
      'core.stop',
    ])
  })

  it('creates conditions registry with every built-in condition', () => {
    const registry = createConditionsRegistry<Ctx>()

    assert.deepEqual([...registry.keys()].sort(), [
      'changed',
      'cooldownReady',
      'empty',
      'eq',
      'exists',
      'falsy',
      'gt',
      'gte',
      'includes',
      'lt',
      'lte',
      'missing',
      'neq',
      'notEmpty',
      'truthy',
      'typeIs',
    ])
  })

  it('allows a runner to override a built-in action without affecting another runner', async () => {
    const first = createRunner<Ctx, string>()
    const second = createRunner<Ctx, string>()

    first.registerAction('core.patch', () => ({ patch: 'override' }))
    first.loadConfig({ strategies: { root: { fn: 'core.patch', props: { patch: 'builtin' } } } })
    second.loadConfig({ strategies: { root: { fn: 'core.patch', props: { patch: 'builtin' } } } })

    assert.deepEqual((await first.run('root', {})).patches, ['override'])
    assert.deepEqual((await second.run('root', {})).patches, ['builtin'])
  })

  it('allows a runner to override a built-in condition without affecting another runner', async () => {
    const first = createRunner<Ctx, string>()
    const second = createRunner<Ctx, string>()
    const config: Config = {
      strategies: {
        root: { fn: 'core.patch', props: { patch: 'matched' }, when: ['eq', 1, 2] },
      },
    }

    first.registerCondition('eq', () => true)
    first.loadConfig(config)
    second.loadConfig(config)

    assert.deepEqual((await first.run('root', {})).patches, ['matched'])
    assert.deepEqual((await second.run('root', {})).patches, [])
  })

  it('registers actions and conditions in batches before validation', () => {
    const runner = createRunner<Ctx>()

    runner.registerActions({
      custom: () => undefined,
    })
    runner.registerConditions({
      allowed: () => true,
    })

    const result = runner.validateConfig({
      strategies: {
        root: { fn: 'custom', when: ['allowed'] },
      },
    })

    assert.equal(result.ok, true)
  })
})
