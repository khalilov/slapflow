import { strict } from 'node:assert'
import { describe, it } from 'vitest'
import {
  createFlow,
  evaluateCondition,
  evaluateExpression,
  type ConditionExpression,
  type ConditionFn,
  type ConditionOutcome,
  type ExpressionOutcome,
} from '~/index'

const guards = {
  'character.step': [
    'and',
    ['eq', '$context.visible', true],
    ['eq', '$context.moving', true],
    ['cooldownReady', '$context.now', '$context.effectAt', 420],
  ],
  'cargo.hit': [
    'and',
    ['eq', '$context.visible', true],
    ['eq', '$context.state', 'fighting'],
    ['eq', '$context.combatTargetType', 'resource:lost-cargo'],
    [
      'cooldownReady',
      '$context.now',
      '$context.effectAt',
      { $expression: ['multiply', '$context.attackDuration', 1000] },
    ],
  ],
}

describe('standalone evaluation', () => {
  it('evaluates guard expressions without creating a flow or runner', () => {
    const context = {
      visible: true,
      moving: true,
      now: 1500,
      effectAt: 1000,
      state: 'fighting',
      combatTargetType: 'resource:lost-cargo',
      attackDuration: 0.5,
    }

    strict.deepEqual(evaluateCondition(guards['character.step'], { context }), { ok: true, matched: true })
    strict.deepEqual(evaluateCondition(guards['cargo.hit'], { context }), { ok: true, matched: true })
    context.now = 1400
    strict.deepEqual(evaluateCondition(guards['character.step'], { context }), { ok: true, matched: false })
    strict.deepEqual(evaluateCondition(guards['cargo.hit'], { context }), { ok: true, matched: false })
  })

  it('resolves nested expressions, templates, and every scope source', () => {
    const result: ExpressionOutcome = evaluateExpression(
      [
        'concat',
        { $template: '{{ context.name }}:' },
        { $expression: ['multiply', '$input.count', '$variables.RATE'] },
        '$data.suffix',
      ],
      { context: { name: 'Ada' }, input: { count: 3 }, data: { suffix: '!' }, variables: { RATE: 2 } }
    )
    const matched: ConditionOutcome = evaluateCondition(
      ['eq', { $expression: ['multiply', '$input.count', '$variables.RATE'] }, '$data.expected'],
      { context: {}, input: { count: 3 }, data: { expected: 6 }, variables: { RATE: 2 } }
    )

    strict.deepEqual(result, { ok: true, value: 'Ada:6!' })
    strict.deepEqual(matched, { ok: true, matched: true })
  })

  it('uses empty optional sources and preserves falsy expression values', () => {
    strict.deepEqual(evaluateCondition(['eq', '$input.missing', '$data.missing'], { context: {} }), {
      ok: true,
      matched: true,
    })
    strict.deepEqual(evaluateCondition(undefined, { context: {} }), { ok: true, matched: true })
    strict.deepEqual(evaluateCondition(false, { context: {} }), { ok: true, matched: false })
    for (const value of [0, false, '']) {
      strict.deepEqual(evaluateExpression(['coalesce', value], { context: {} }), { ok: true, value })
    }
    strict.deepEqual(evaluateExpression(['property', '$context', 'value'], { context: { value: null } }), {
      ok: true,
      value: null,
    })
    strict.deepEqual(evaluateExpression(['coalesce', undefined], { context: {} }), { ok: true, value: undefined })
  })

  it('supplies the condition runtime and preserves caller context and data identity', () => {
    const context = { value: 4 }
    const input = { id: 'task-1' }
    const data = { count: 1 }
    const custom: ConditionFn<typeof context> = ({ context, input, data, runtime }, expected) => {
      strict.equal(context, scope.context)
      strict.equal(input, scope.input)
      strict.equal(data, scope.data)
      strict.equal(runtime.get('value'), 4)
      strict.equal(runtime.data.get('count'), 1)
      strict.ok(runtime.variables)
      strict.equal(runtime.variables.get('LIMIT'), 8)
      strict.equal(runtime.resolve({ $expression: ['double', '$context.value'] }), 8)
      runtime.data.set('count', 2)

      return runtime.resolve('$variables.LIMIT') === expected
    }
    const scope = { context, input, data, variables: { LIMIT: 8 } }
    const options = { conditions: { custom }, expressions: { double: ([value]: unknown[]) => Number(value) * 2 } }

    strict.deepEqual(evaluateCondition(['custom', 8], scope, options), { ok: true, matched: true })
    strict.equal(data.count, 2)
    strict.deepEqual(evaluateExpression(['double', '$context.value'], scope, options), { ok: true, value: 8 })
  })

  it('short-circuits and/or without invoking handlers or resolving skipped arguments', () => {
    const calls: string[] = []
    const options = {
      conditions: {
        called: () => {
          calls.push('called')
          return true
        },
      },
    }
    const invalidArgument = ['eq', { $expression: ['divide', 1, 0] }, 0]

    strict.deepEqual(evaluateCondition(['and', false, ['called'], invalidArgument], { context: {} }, options), {
      ok: true,
      matched: false,
    })
    strict.deepEqual(evaluateCondition(['or', true, ['called'], invalidArgument], { context: {} }, options), {
      ok: true,
      matched: true,
    })
    strict.deepEqual(calls, [])
    strict.deepEqual(evaluateCondition(['not', false], { context: {} }), { ok: true, matched: true })
  })

  it('preserves root ensure without executing a catch branch', () => {
    strict.deepEqual(evaluateCondition(['ensure', ['exists', '$input.sessionId']], { context: {} }), {
      ok: true,
      matched: false,
      ensure: true,
    })
    strict.deepEqual(evaluateCondition(['ensure', true], { context: {} }), { ok: true, matched: true })
  })

  it.each([
    { expression: null, code: 'CONDITION_INVALID' },
    { expression: [], code: 'CONDITION_INVALID' },
    { expression: ['not'], code: 'CONDITION_INVALID' },
    { expression: ['not', true, false], code: 'CONDITION_INVALID' },
    { expression: ['ensure'], code: 'CONDITION_INVALID' },
    { expression: ['and', ['ensure', true]], code: 'ENSURE_PLACEMENT_INVALID' },
    { expression: ['unknown'], code: 'CONDITION_NOT_FOUND' },
    { expression: ['guard', 'cargo.hit'], code: 'CONDITION_NOT_FOUND' },
    { expression: ['eq', '$variables.MISSING', 1], code: 'VARIABLE_NOT_FOUND' },
    { expression: ['eq', { $expression: ['divide', 1, 0] }, 0], code: 'EXPRESSION_DIVISION_BY_ZERO' },
  ])('returns $code for invalid condition $expression', ({ expression, code }) => {
    const result = evaluateCondition(expression, { context: {} })

    strict.equal(result.ok, false)
    if (result.ok === false) {
      strict.equal(result.error.code, code)
      if (code === 'VARIABLE_NOT_FOUND') {
        strict.equal(result.error.path, 'when[1]')
      }
    }
  })

  it.each([
    { expression: null, code: 'EXPRESSION_INVALID_ARGUMENT' },
    { expression: [], code: 'EXPRESSION_INVALID_ARGUMENT' },
    { expression: { $expression: ['add', 1, 2] }, code: 'EXPRESSION_INVALID_ARGUMENT' },
    { expression: ['unknown'], code: 'EXPRESSION_OPERATOR_NOT_FOUND' },
    { expression: ['divide', 1, 0], code: 'EXPRESSION_DIVISION_BY_ZERO' },
    { expression: ['add', 1, '2'], code: 'EXPRESSION_INVALID_ARGUMENT' },
    { expression: ['add', 1, '$variables.MISSING'], code: 'VARIABLE_NOT_FOUND' },
    { expression: ['get', {}, 'missing'], code: 'EXPRESSION_PATH_NOT_FOUND' },
    { expression: ['coalesce'], code: 'EXPRESSION_INVALID_ARGUMENT' },
    { expression: ['at', ['a'], 0, 'unexpected'], code: 'EXPRESSION_INVALID_ARGUMENT' },
    { expression: ['at', [], 0], code: 'EXPRESSION_PATH_NOT_FOUND' },
  ])('returns $code for invalid expression $expression', ({ expression, code }) => {
    const result = evaluateExpression(expression, { context: {} })

    strict.equal(result.ok, false)
    if (result.ok === false) {
      strict.equal(result.error.code, code)
    }
  })

  it('returns callback errors without exposing their messages or scope values', () => {
    const secret = 'private-value'
    const broken = () => {
      throw new Error(secret)
    }
    const condition = evaluateCondition(['broken'], { context: { secret } }, { conditions: { broken } })
    const expression = evaluateExpression(['broken'], { context: { secret } }, { expressions: { broken } })

    strict.equal(condition.ok, false)
    strict.equal(expression.ok, false)
    strict.equal(JSON.stringify(condition).includes(secret), false)
    strict.equal(JSON.stringify(expression).includes(secret), false)
  })

  it('rejects attempts to replace a built-in condition', () => {
    const result = evaluateCondition(['eq', 1, 1], { context: {} }, { conditions: { eq: () => false } })

    strict.equal(result.ok, false)
  })

  it('reuses the runner runtime and registered handlers for conditions and expressions', () => {
    const context = { amount: 3, result: 0 }
    const seen: unknown[] = []
    const custom: ConditionFn<typeof context> = ({ runtime }, value) => {
      seen.push(runtime)
      runtime.data.set('amount', value)

      return value === runtime.variables?.get('LIMIT')
    }
    const double = ([value]: unknown[]) => Number(value) * 2
    const flow = createFlow(
      {
        config: {
          strategies: {
            root: {
              fn: 'apply',
              when: ['custom', { $expression: ['double', '$context.amount'] }],
              props: { amount: { $expression: ['double', '$context.amount'] } },
            },
          },
        },
        conditions: { custom },
        actions: {
          apply: ({ context, runtime, props: { amount } }) => {
            strict.equal(runtime, seen[0])
            strict.equal(runtime.data.get('amount'), amount)
            context.result = Number(amount)
          },
        },
      },
      { context, variables: { LIMIT: 6 }, expressions: { double } }
    )

    flow.start()
    strict.equal(flow.runner.runSync('root', context).status, 'success')
    flow.stop()
    strict.equal(context.result, 6)
  })

  it('returns condition callback failures through the runner with condition diagnostics', () => {
    const broken: ConditionFn<object> = () => {
      throw new Error('private value')
    }
    const standalone = evaluateCondition(['broken'], { context: {}, strategy: 'root' }, { conditions: { broken } })
    const flow = createFlow(
      {
        config: { strategies: { root: { fn: 'core.noop', when: ['broken'] } } },
        conditions: { broken },
      },
      { context: {} }
    )

    const { validation } = flow.start()
    const result = flow.runner.runSync('root', {})

    strict.equal(validation.ok, true)
    flow.stop()
    strict.equal(result.status, 'failed')
    strict.equal(result.error?.code, 'CONDITION_THROWN')
    strict.equal(result.error?.strategy, 'root')
    strict.equal(result.error?.stage?.phase, 'condition')
    strict.equal(standalone.ok, false)
    if (standalone.ok === false) {
      strict.equal(result.error?.path, standalone.error.path)
    }
    strict.equal(JSON.stringify(result.error).includes('private value'), false)
  })

  it('retains expression error paths through standalone and runner evaluation', () => {
    const expression = ['multiply', '$variables.MISSING', 1000]
    const standalone = evaluateExpression(expression, { context: {}, configPath: 'strategies.root.props.value' })
    const flow = createFlow(
      {
        config: { strategies: { root: { fn: 'core.noop', props: { value: { $expression: expression } } } } },
      },
      { context: {} }
    )

    const { validation } = flow.start()
    const result = flow.runner.runSync('root', {})

    strict.equal(validation.ok, true)
    flow.stop()
    strict.equal(result.error?.code, 'VARIABLE_NOT_FOUND')
    strict.equal(result.error?.path, 'strategies.root.props.value.$expression[1]')
    strict.equal(standalone.ok, false)
    if (standalone.ok === false) {
      strict.equal(result.error?.path, standalone.error.path)
    }
  })

  it.each([500, 499])('matches flow execution at cooldown elapsed %i', (now) => {
    const context = { now, effectAt: 0, attackDuration: 0.5, result: 0, matched: false }
    const expression = ['multiply', '$context.attackDuration', 1000]
    const condition: ConditionExpression = [
      'cooldownReady',
      '$context.now',
      '$context.effectAt',
      { $expression: expression },
    ]
    const flow = createFlow(
      {
        config: {
          strategies: { root: { fn: 'apply', when: condition, props: { result: { $expression: expression } } } },
        },
        actions: {
          apply: ({ context, props: { result } }) => {
            context.result = Number(result)
            context.matched = true
          },
        },
      },
      { context }
    )
    const standaloneCondition = evaluateCondition(condition, { context })
    const standaloneExpression = evaluateExpression(expression, { context })

    flow.start()
    flow.runner.runSync('root', context)
    flow.stop()
    strict.deepEqual(standaloneCondition, { ok: true, matched: context.matched })
    strict.deepEqual(standaloneExpression, { ok: true, value: 500 })
    if (context.matched) {
      strict.equal(context.result, 500)
    }
  })
})
