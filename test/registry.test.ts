import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/createRunner'
import { BUILTIN_ACTIONS } from '~/helpers/actions'
import { BUILTIN_CONDITIONS } from '~/helpers/conditions'

type Ctx = {
  value?: number
}

describe('registry', () => {
  it('lists every built-in action', () => {
    assert.deepEqual(BUILTIN_ACTIONS.map(([name]) => name).sort(), [
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

  it('lists every built-in condition', () => {
    assert.deepEqual(BUILTIN_CONDITIONS.map(([name]) => name).sort(), [
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

  it('rejects overriding a built-in action', () => {
    const runner = createRunner<Ctx, string>()

    assert.throws(() => runner.registerAction('core.patch', () => ({ patch: 'override' })), /core\.patch/)
  })

  it('rejects overriding a built-in condition', () => {
    const runner = createRunner<Ctx, string>()

    assert.throws(() => runner.registerCondition('eq', () => true), /eq/)
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
