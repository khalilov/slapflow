import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createConditionsRegistry } from '~/registry/conditions'
import { includesCondition } from '~/helpers/conditions/includesCondition'
import { sizeOf } from '~/helpers/conditions/sizeOf'
import { evaluateCondition } from '~/helpers/runner/evaluateCondition'
import { createRuntime } from '~/helpers/runner/createRuntime'
import { type RunState } from '~/helpers/runner/runnerTypes'

type Ctx = {
  count?: number
  nested?: {
    value?: string
    items?: string[]
  }
  previous?: number
  now?: number
}

const createScope = (context: Ctx = {}, data: Record<string, unknown> = {}) => {
  const state: RunState<Ctx, string> = {
    context,
    input: { target: 'alpha' },
    data,
    patches: [],
    events: [],
    stepCounter: { current: 0 },
    startedAt: Date.now(),
    sync: false,
    signal: new AbortController().signal,
    abort: () => undefined,
    closed: false,
    reportedErrors: [],
    variables: {},
    expressions: {},
  }

  return {
    context: state.context,
    input: state.input,
    data: state.data,
    runtime: createRuntime(state),
  }
}

const assertMatches = (expression: Parameters<typeof evaluateCondition<Ctx>>[0], expected: boolean): void => {
  const result = evaluateCondition(expression, createConditionsRegistry<Ctx>(), createScope())

  assert.deepEqual(result, { ok: true, matched: expected })
}

describe('built-in conditions', () => {
  it('evaluates equality and comparison operators', () => {
    assertMatches(['eq', 1, 1], true)
    assertMatches(['eq', Number.NaN, Number.NaN], true)
    assertMatches(['neq', 1, 2], true)
    assertMatches(['gt', 3, 2], true)
    assertMatches(['gte', 2, 2], true)
    assertMatches(['lt', 1, 2], true)
    assertMatches(['lte', 2, 2], true)
    assertMatches(['gt', '1', 2], false)
  })

  it('evaluates truthy, falsy, exists and missing operators', () => {
    assertMatches(['truthy', 'value'], true)
    assertMatches(['truthy', ''], false)
    assertMatches(['falsy', 0], true)
    assertMatches(['exists', null], false)
    assertMatches(['exists', ''], true)
    assertMatches(['missing', undefined], true)
    assertMatches(['missing', false], false)
  })

  it('evaluates empty and notEmpty operators for common collection shapes', () => {
    assertMatches(['empty', []], true)
    assertMatches(['empty', ''], true)
    assertMatches(['empty', {}], true)
    assertMatches(['notEmpty', ['x']], true)
    assertMatches(['notEmpty', 'x'], true)
    assertMatches(['notEmpty', { x: 1 }], true)
    assert.equal(sizeOf(new Set()), 0)
    assert.equal(sizeOf(new Map([['x', 1]])), 1)
  })

  it('evaluates includes, changed and cooldownReady operators', () => {
    assertMatches(['includes', ['a', 'b'], 'b'], true)
    assertMatches(['includes', 'alpha', 'ph'], true)
    assertMatches(['includes', { a: true }, 'a'], false)
    assert.equal(includesCondition({}, new Set(['a']), 'a'), true)
    assertMatches(['changed', 1, 2], true)
    assertMatches(['changed', 1, 1], false)
    assertMatches(['cooldownReady', 100, undefined, 50], true)
    assertMatches(['cooldownReady', 100, 40, 50], true)
    assertMatches(['cooldownReady', 100, 80, 50], false)
  })

  it('evaluates type categories without coercion', () => {
    assertMatches(['typeIs', 'value', 'string'], true)
    assertMatches(['typeIs', 1, 'string'], false)
    assertMatches(['typeIs', Number.NaN, 'number'], true)
    assertMatches(['typeIs', 1, 'finite-number'], true)
    assertMatches(['typeIs', Number.NaN, 'finite-number'], false)
    assertMatches(['typeIs', Number.POSITIVE_INFINITY, 'finite-number'], false)
    assertMatches(['typeIs', false, 'boolean'], true)
    assertMatches(['typeIs', [], 'array'], true)
    assertMatches(['typeIs', {}, 'record'], true)
    assertMatches(['typeIs', null, 'record'], false)
    assertMatches(['typeIs', [], 'record'], false)
    assertMatches(['typeIs', 'value', 'unknown'], false)
  })

  it('resolves path references before condition execution', () => {
    const result = evaluateCondition(
      ['and', ['eq', '$context.count', 2], ['eq', '$data.selected', '$input.target']],
      createConditionsRegistry<Ctx>(),
      createScope({ count: 2 }, { selected: 'alpha' })
    )

    assert.deepEqual(result, { ok: true, matched: true })
  })

  it('evaluates and, or and not control expressions', () => {
    assertMatches(['and', true, ['eq', 1, 1], ['not', ['eq', 1, 2]]], true)
    assertMatches(['and', true, ['eq', 1, 2]], false)
    assertMatches(['or', false, ['eq', 1, 2], ['eq', 1, 1]], true)
    assertMatches(['or', false, ['eq', 1, 2]], false)
    assertMatches(['not', ['truthy', 'x']], false)
  })

  it('returns an error for unknown condition operators', () => {
    const result = evaluateCondition(['unknown'], createConditionsRegistry<Ctx>(), createScope())

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'CONDITION_NOT_FOUND')
    }
  })

  it('uses a valid error path when strategy is omitted', () => {
    const result = evaluateCondition(['eq', '$variables.MISSING', 1], createConditionsRegistry<Ctx>(), createScope())

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.path, 'when[1]')
    }
  })
})
