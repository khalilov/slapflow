import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/createRunner'
import { evaluateCondition } from '~/evaluateCondition'
import { evaluateExpression } from '~/evaluateExpression'
import { type ConditionFn, type Config, type TypeRules } from '~/types'

type UserContext = { userId: unknown }
type NestedInput = { payload: { items: Array<{ owner: UserContext }> } }

describe('runtime field types in conditions', () => {
  it('checks a referenced field at any depth without scanning neighbouring values', () => {
    const types: TypeRules = { userId: ['string', null, 'undefined'] }
    const context = { unused: { userId: 42 }, sparse: new Array(2) }
    const input: NestedInput = { payload: { items: [{ owner: { userId: 'u-1' } }] } }
    const expression = ['exists', '$input.payload.items[0].owner.userId']

    Object.defineProperty(context, 'unread', {
      enumerable: true,
      get: () => {
        throw new Error('must not be read')
      },
    })
    assert.deepEqual(evaluateCondition(expression, { context, input, types }), { ok: true, matched: true })
    assert.deepEqual(evaluateCondition(['exists', '$context.absent.userId'], { context, types }), {
      ok: true,
      matched: false,
    })
    input.payload.items[0]!.owner.userId = 42

    assert.deepEqual(evaluateCondition(expression, { context, input, types }), {
      ok: false,
      error: {
        code: 'TYPE_MISMATCH',
        message: 'input.payload.items[0].owner.userId expected string | null | undefined, received number',
        path: 'input.payload.items[0].owner.userId',
      },
    })
  })

  it('uses only declared own rules and checks only the fields requested by contains', () => {
    const types: TypeRules = { requestId: 'string', userId: ['string', null] }
    const input = { payload: { requestId: 'r-1', userId: 42, toString: 'text' } }

    assert.deepEqual(
      evaluateCondition(['contains', '$input.payload', ['requestId', 'toString']], { context: {}, input, types }),
      { ok: true, matched: true }
    )
    assert.deepEqual(evaluateCondition(['eq', '$input.payload.toString', 'text'], { context: {}, input, types }), {
      ok: true,
      matched: true,
    })
    assert.deepEqual(evaluateCondition(['contains', '$input.payload', ['missing']], { context: {}, input, types }), {
      ok: true,
      matched: false,
    })
    assert.deepEqual(evaluateCondition(['contains', { userId: null }, ['userId']], { context: {}, types }), {
      ok: true,
      matched: false,
    })
    assert.deepEqual(evaluateCondition(['contains', '$input.payload', ['userId']], { context: {}, input, types }), {
      ok: false,
      error: {
        code: 'TYPE_MISMATCH',
        message: 'contains.userId expected string | null, received number',
        path: 'contains.userId',
      },
    })
  })

  it('keeps short circuiting and checks the current value when a later condition reads it', () => {
    const types: TypeRules = { userId: 'string' }
    const context: UserContext = { userId: 'u-1' }
    const mutate: ConditionFn<UserContext> = ({ context }) => {
      context.userId = 42
      return true
    }
    const options = { conditions: { mutate } }
    const result = evaluateCondition(['and', ['mutate'], ['exists', '$context.userId']], { context, types }, options)

    assert.equal(result.ok, false)
    if ('error' in result) {
      assert.equal(result.error.code, 'TYPE_MISMATCH')
    }
    assert.deepEqual(evaluateCondition(['or', true, ['exists', '$context.userId']], { context, types }), {
      ok: true,
      matched: true,
    })
  })

  it('checks reads through condition runtime helpers, nested expressions and templates', () => {
    const types: TypeRules = { userId: 'string' }
    const expressions = [
      ['exists', { $expression: ['coalesce', '$context.userId', 'fallback'] }],
      ['exists', { $template: '{{ context.userId }}' }],
    ]
    const helperResult = evaluateCondition(
      ['custom'],
      { context: {}, types },
      { conditions: { custom: ({ runtime }) => runtime.get('userId') === undefined } }
    )

    assert.equal(helperResult.ok, false)
    if ('error' in helperResult) {
      assert.equal(helperResult.error.code, 'TYPE_MISMATCH')
    }
    for (const expression of expressions) {
      const result = evaluateCondition(expression, { context: {}, types })

      assert.equal(result.ok, false)
      if ('error' in result) {
        assert.equal(result.error.code, 'TYPE_MISMATCH')
      }
    }
    assert.deepEqual(
      evaluateExpression(['coalesce', '$context.other', 'fallback'], { context: { userId: 42 }, types }),
      { ok: true, value: 'fallback' }
    )
  })

  it('passes rules to strategy and transition guards and keeps ordinary catch handling', async () => {
    const reports: string[] = []
    const runner = createRunner({
      onError: ({ error: { code } }) => {
        reports.push(code)
      },
    })
    const config: Config = {
      types: { userId: 'string' },
      guards: { 'has-user': ['exists', '$input.userId'] },
      strategies: {
        root: { fn: 'core.noop', then: [{ strategy: 'guarded', when: ['guard', 'has-user'] }] },
        guarded: { fn: 'core.patch', props: { patch: 'guarded' }, when: ['guard', 'has-user'], catch: ['recover'] },
        recover: { fn: 'core.patch', props: { patch: 'recovered' } },
      },
    }

    assert.equal(runner.loadConfig(config).ok, true)
    assert.deepEqual((await runner.run('root', {}, { userId: 'u-1' })).patches, ['guarded'])
    assert.equal((await runner.run('root', {}, { userId: 42 })).error?.code, 'TYPE_MISMATCH')
    assert.deepEqual((await runner.run('guarded', {}, { userId: 42 })).patches, ['recovered'])
    assert.deepEqual(reports, ['TYPE_MISMATCH', 'TYPE_MISMATCH'])
  })

  it('does not validate action props, direct runtime reads or action results', async () => {
    const runner = createRunner<UserContext>()
    const context = { userId: 42 }

    runner.registerAction('mutate', ({ context, props: { userId }, runtime }) => {
      assert.equal(userId, 123)
      assert.equal(runtime.get('userId'), 42)
      assert.equal(runtime.resolve('$context.userId'), 42)
      context.userId = false

      return { context }
    })
    runner.loadConfig({ types: { userId: 'string' }, strategies: { root: { fn: 'mutate', props: { userId: 123 } } } })
    assert.equal((await runner.run('root', context)).status, 'success')
    assert.equal(context.userId, false)
  })

  it('rejects malformed declarations including sparse unions', () => {
    const runner = createRunner()
    const declarations: unknown[] = [[], 'null', 'uuid', { type: 'string' }, [['string']], new Array(1)]

    for (const declaration of declarations) {
      const result = runner.validateConfig({
        types: { userId: declaration } as TypeRules,
        strategies: { root: { fn: 'core.noop' } },
      })

      assert.equal(result.ok, false)
      assert.deepEqual(
        result.errors.map(({ code, path }) => ({ code, path })),
        [{ code: 'CONFIG_TYPES_INVALID', path: 'types.userId' }]
      )
    }
  })
})
