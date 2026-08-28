import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/runner'

describe('validation', () => {
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
    const escaped = [
      '\\${NAME}',
      '\\{{ user.name }}',
      '\\\\${NAME}',
      '\\\\\\${NAME}',
      '${NAME} \\${NAME}',
      '\\${BROKEN',
      '\\x',
      '\\\\',
      '',
      '\\${A} ${B} \\{{ x }} {{ y }}',
    ]

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
