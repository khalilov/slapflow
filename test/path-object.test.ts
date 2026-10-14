import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { isPathReference } from '~/helpers/path/isPathReference'
import { isValidPathReference } from '~/helpers/path/isValidPathReference'
import { resolveValue } from '~/helpers/path/resolveValue'

describe('path and object helpers', () => {
  it('detects and validates path references', () => {
    assert.equal(isPathReference('$context.user'), true)
    assert.equal(isPathReference('context.user'), false)
    assert.equal(isValidPathReference('$context.user.name'), true)
    assert.equal(isValidPathReference('$data.items[0].id'), true)
    assert.equal(isValidPathReference('$input'), true)
    assert.equal(isValidPathReference('$unknown.user'), false)
    assert.equal(isValidPathReference('$context.user name'), false)
  })

  it('preserves objwalk access semantics for existing runtime roots', () => {
    const inherited = Object.create({ constructorValue: 7 }) as Record<string, unknown>
    inherited.own = 1
    const scope = {
      context: inherited,
      data: {},
      input: {},
      variables: {},
    }

    assert.equal(resolveValue('$context.constructorValue', scope), 7)
    assert.equal(resolveValue('$context.constructor', scope), Object)
    assert.equal(resolveValue('$context.own', scope), 1)
  })

  it('does not recursively reinterpret template substitutions', () => {
    const scope = {
      context: {},
      data: { legacy: '${HOME}' },
      input: {},
      variables: { HOME: 'secret', MODERN: '{{ legacy }}' },
    }

    assert.equal(resolveValue({ $template: '{{ legacy }}' }, scope), '${HOME}')
    assert.equal(resolveValue({ $template: '${MODERN}' }, scope), '{{ legacy }}')
  })
})
