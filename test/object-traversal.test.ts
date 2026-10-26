import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { type ValidationIssue } from '~/types'
import { dependsOnVariables } from '~/helpers/trace/dependsOnVariables'
import { validateRefs } from '~/helpers/validation/validateRefs'
import { compactErrorStage } from '~/helpers/errors/compactErrorStage'
import { sizeOf } from '~/helpers/conditions/sizeOf'
import { parsePayload } from '~/helpers/parsePayload'

describe('object traversal contracts', () => {
  it('stops variable discovery before reading later values', () => {
    const value = Object.defineProperty({ first: '$variables.SECRET' }, 'later', {
      enumerable: true,
      get: () => {
        throw new Error('must not be read')
      },
    })

    assert.equal(dependsOnVariables(value), true)
    assert.equal(dependsOnVariables('$variables.SECRET'), true)
    assert.equal(dependsOnVariables([false, { value: '$variables.SECRET' }]), true)
    assert.equal(dependsOnVariables([0, false, null]), false)
  })

  it('treats templates as atomic values during variable discovery', () => {
    assert.equal(dependsOnVariables({ $template: '${SECRET}' }), true)
    assert.equal(dependsOnVariables({ $template: '\\${SECRET}', sibling: '$variables.SECRET' }), false)
    assert.equal(dependsOnVariables({ $template: '${BROKEN', sibling: '$variables.SECRET' }), false)
  })

  it('preserves validation paths for root references, nested arrays and templates', () => {
    const errors: ValidationIssue[] = []

    validateRefs('$context.bad name', 'root', 'props', errors)
    validateRefs(
      { list: ['$input.bad name'], value: { $template: '{{ broken' }, 'literal.key': '$data.bad name' },
      'root',
      'props',
      errors
    )
    assert.deepEqual(
      errors.map(({ code, path }) => ({ code, path })),
      [
        { code: 'PATH_INVALID', path: 'props' },
        { code: 'PATH_INVALID', path: 'props.list[0]' },
        { code: 'TEMPLATE_INVALID', path: 'props.value.$template' },
        { code: 'PATH_INVALID', path: 'props.literal.key' },
      ]
    )
  })

  it('removes undefined error fields without discarding zero or empty values', () => {
    const stage = { phase: 'action' as const, strategy: '', entrypoint: undefined, step: 0, depth: 0 }
    const result = compactErrorStage(stage)

    assert.deepEqual(result, { phase: 'action', strategy: '', step: 0, depth: 0 })
    assert.equal(Object.hasOwn(result, 'entrypoint'), false)
    assert.equal(Object.hasOwn(stage, 'entrypoint'), true)
  })

  it('counts own object fields and preserves collection and nullish size rules', () => {
    const object = Object.assign(Object.create({ inherited: true }), { first: false, second: undefined })

    assert.equal(sizeOf(object), 2)
    assert.equal(sizeOf([, 1]), 2)
    assert.equal(sizeOf('abc'), 3)
    assert.equal(sizeOf(new Set([1, 2])), 2)
    assert.equal(sizeOf(new Map([['key', 1]])), 1)
    assert.equal(sizeOf(null), 0)
    assert.equal(sizeOf(undefined), 0)
  })

  it('parses string frames while preserving ready and binary frame identity', () => {
    const object = { ready: true }
    const buffer = Buffer.from('{"ready":true}')
    const binary = new ArrayBuffer(8)
    const view = new DataView(binary)

    assert.deepEqual(parsePayload('{"ready":true}'), object)
    assert.equal(parsePayload('false'), false)
    assert.equal(parsePayload('0'), 0)
    assert.equal(parsePayload('null'), null)
    assert.equal(parsePayload('""'), '')
    assert.equal(parsePayload('broken'), 'broken')
    assert.equal(parsePayload(object), object)
    assert.equal(parsePayload(buffer), buffer)
    assert.equal(parsePayload(binary), binary)
    assert.equal(parsePayload(view), view)
    assert.equal(parsePayload(undefined), undefined)
  })
})
