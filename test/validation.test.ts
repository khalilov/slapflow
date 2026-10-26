import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/createRunner'

describe('validation', () => {
  it('rejects null guard dictionaries instead of accepting an empty traversal', () => {
    const runner = createRunner()
    const result = runner.validateConfig({ strategies: { root: { fn: 'core.noop' } }, guards: null as never })

    assert.equal(result.ok, false)
    assert.deepEqual(
      result.errors.map(({ code, path }) => ({ code, path })),
      [{ code: 'GUARD_INVALID', path: 'guards' }]
    )
  })

  it('continues validation across independent cycles and entrypoints', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      entrypoints: { 'missing.first': 'first-missing', 'missing.second': 'second-missing' },
      strategies: {
        'cycle.first': { fn: 'core.noop', then: ['cycle.first'] },
        'cycle.second': { fn: 'core.noop', then: ['cycle.second'] },
      },
    })

    assert.deepEqual(
      result.errors.filter(({ code }) => code === 'CYCLE_DETECTED').map(({ strategy }) => strategy),
      ['cycle.first', 'cycle.second']
    )
    assert.deepEqual(
      result.errors.filter(({ code }) => code === 'STRATEGY_NOT_FOUND').map(({ path }) => path),
      ['entrypoints.missing.first', 'entrypoints.missing.second']
    )
  })

  it('catches unknown fn, then target and condition', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      strategies: {
        root: { fn: 'missing.action', then: ['missing.strategy'], when: ['missingCondition', '$context.worker'] },
      },
    })
    assert.equal(result.ok, false)
    assert.deepEqual(
      new Set(result.errors.map((error) => error.code)),
      new Set(['ACTION_NOT_FOUND', 'STRATEGY_NOT_FOUND', 'CONDITION_NOT_FOUND'])
    )
  })

  it('reports invalid path refs with bracket-index paths for arrays', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      strategies: {
        root: { fn: 'core.noop', props: { list: ['$bad.path'] } },
      },
    })

    assert.equal(result.ok, false)
    assert.deepEqual(
      result.errors.map((error) => error.path),
      ['root.props.list[0]']
    )
  })

  it('rejects malformed then and catch items', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      strategies: {
        root: { fn: 'core.noop', then: [null as never], catch: [{} as never] },
      },
    })

    assert.equal(result.ok, false)
    assert.equal(result.errors.filter((error) => error.code === 'STRATEGY_NOT_FOUND').length, 2)
  })

  it('validates props and conditions of then and catch items', () => {
    const runner = createRunner()
    const result = runner.validateConfig({
      strategies: {
        root: {
          fn: 'core.noop',
          then: [{ strategy: 'next', props: { value: '$wrong.path' }, when: ['missingCondition'] }],
          catch: [{ strategy: 'next', props: { value: '$also.wrong' }, when: ['missingCondition'] }],
        },
        next: { fn: 'core.noop' },
      },
    })

    assert.deepEqual(result.errors.map((error) => error.code).sort(), [
      'CONDITION_NOT_FOUND',
      'CONDITION_NOT_FOUND',
      'PATH_INVALID',
      'PATH_INVALID',
    ])
  })

  it('accepts variable templates and expressions', () => {
    const runner = createRunner()
    const result = runner.loadConfig({
      version: 1,
      entrypoints: {
        'account.load': 'account.load',
      },
      strategies: {
        'account.load': {
          fn: 'core.noop',
          props: {
            url: { $template: '${AUTH_SERVICE_BASE}/auth/me' },
            timeout: '$variables.HTTP_TIMEOUT',
            total: { $expression: ['multiply', '$data.price', '$input.amount'] },
          },
        },
      },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.errors, [])
  })

  it('rejects malformed variable templates', () => {
    const malformed = ['${AUTH_SERVICE_BASE', '${1BAD}', '${FOO:bar}']

    for (const template of malformed) {
      const runner = createRunner()
      const result = runner.loadConfig({
        strategies: {
          root: { fn: 'core.noop', props: { value: { $template: template } } },
        },
      })

      assert.equal(result.ok, false)
      assert.equal(
        result.errors.some(({ code }) => code === 'TEMPLATE_INVALID'),
        true
      )
    }
  })

  it('accepts escaped template delimiters', () => {
    const escaped = ['\\${BROKEN', '\\{{ user.name }}']

    for (const template of escaped) {
      const runner = createRunner()
      const result = runner.loadConfig({
        strategies: {
          root: { fn: 'core.noop', props: { value: { $template: template } } },
        },
      })

      assert.equal(result.ok, true)
    }
  })
})
