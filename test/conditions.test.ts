import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { evaluateCondition } from '~/evaluateCondition'

const assertMatches = (
  expression: Parameters<typeof evaluateCondition>[0],
  expected: boolean,
  context: Record<string, unknown> = {}
): void => {
  const result = evaluateCondition(expression, { context })

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
    assertMatches(['empty', '$context.items'], true, { items: new Set() })
    assertMatches(['notEmpty', '$context.items'], true, { items: new Map([['x', 1]]) })
  })

  it('evaluates includes, changed and cooldownReady operators', () => {
    assertMatches(['includes', ['a', 'b'], 'b'], true)
    assertMatches(['includes', 'alpha', 'ph'], true)
    assertMatches(['includes', { a: true }, 'a'], false)
    assertMatches(['includes', '$context.items', 'a'], true, { items: new Set(['a']) })
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
    const result = evaluateCondition(['and', ['eq', '$context.count', 2], ['eq', '$data.selected', '$input.target']], {
      context: { count: 2 },
      data: { selected: 'alpha' },
      input: { target: 'alpha' },
    })

    assert.deepEqual(result, { ok: true, matched: true })
  })

  it('evaluates and, or and not control expressions', () => {
    assertMatches(['and', true, ['eq', 1, 1], ['not', ['eq', 1, 2]]], true)
    assertMatches(['and', true, ['eq', 1, 2]], false)
    assertMatches(['or', false, ['eq', 1, 2], ['eq', 1, 1]], true)
    assertMatches(['or', false, ['eq', 1, 2]], false)
    assertMatches(['not', ['truthy', 'x']], false)
  })
})
