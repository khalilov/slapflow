import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { ResolutionError } from '~/helpers/path/ResolutionError'
import { resolveValue } from '~/helpers/path/resolveValue'
import { type ResolveScope } from '~/helpers/path/resolveScope'

type Context = {
  user: { name: string }
}

const scope: ResolveScope<Context> = {
  context: { user: { name: 'Ada' } },
  data: { count: 2, items: ['a', 'b'] },
  input: { id: 'job-1' },
  variables: { SECRET: 's3cr3t' },
  expressions: { double: (args) => Number(args[0]) * 2 },
}

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (error) {
    return (error as ResolutionError).slapError?.code
  }

  return undefined
}

describe('resolveValue', () => {
  it('resolves scoped, nested, and array paths', () => {
    assert.equal(resolveValue('$context.user.name', scope), 'Ada')
    assert.equal(resolveValue('$input.id', scope), 'job-1')
    assert.equal(resolveValue('$data.items[1]', scope), 'b')
    assert.equal(resolveValue('$context.user.missing', scope), undefined)
  })

  it('returns scalars and functions unchanged', () => {
    assert.equal(resolveValue(42, scope), 42)
    assert.equal(resolveValue(false, scope), false)
    assert.equal(resolveValue(null, scope), null)

    const fn = (): void => undefined

    assert.equal(resolveValue(fn, scope), fn)
  })

  it('resolves variables and fails when one is missing', () => {
    assert.deepEqual(resolveValue('$variables', scope), { SECRET: 's3cr3t' })
    assert.equal(resolveValue('$variables.SECRET', scope), 's3cr3t')
    assert.equal(
      codeOf(() => resolveValue('$variables.MISSING', scope)),
      'VARIABLE_NOT_FOUND'
    )
  })

  it('evaluates expressions and rejects malformed ones', () => {
    assert.equal(resolveValue({ $expression: ['double', 21] }, scope), 42)
    assert.equal(
      codeOf(() => resolveValue({ $expression: [] }, scope)),
      'EXPRESSION_INVALID_ARGUMENT'
    )
  })

  it('ignores sibling keys when $expression is present', () => {
    assert.equal(resolveValue({ $expression: ['double', 3], count: '$data.count' }, scope), 6)
  })

  it('renders templates and rejects malformed ones', () => {
    assert.equal(
      resolveValue({ $template: '{{ context.user.name }}:{{ input.id }}:{{ data.count }}' }, scope),
      'Ada:job-1:2'
    )
    assert.equal(
      codeOf(() => resolveValue({ $template: '{{ broken' }, scope)),
      'TEMPLATE_INVALID'
    )
  })

  it('ignores sibling keys when $template is present', () => {
    assert.equal(resolveValue({ $template: 'Hi {{ context.user.name }}', count: '$data.count' }, scope), 'Hi Ada')
  })

  it('resolves nested objects and arrays recursively', () => {
    assert.deepEqual(resolveValue({ id: '$input.id', list: ['$data.count', '$context.user.name'] }, scope), {
      id: 'job-1',
      list: [2, 'Ada'],
    })
  })
})
