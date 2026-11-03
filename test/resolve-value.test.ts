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
  variables: { SECRET: 's3cr3t', NAME: 'Ada' },
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
    const current = {
      ...scope,
      context: { user: { name: 'Grace' } },
      input: { id: 'job-2' },
      data: { items: ['c', 'd'] },
    }

    assert.equal(resolveValue('$context.user.name', scope), 'Ada')
    assert.equal(resolveValue('$input.id', scope), 'job-1')
    assert.equal(resolveValue('$data.items[1]', scope), 'b')
    assert.equal(resolveValue('$context.user.missing', scope), undefined)

    assert.equal(resolveValue('$context.user.name', current), 'Grace')
    assert.equal(resolveValue('$input.id', current), 'job-2')
    assert.equal(resolveValue('$data.items[1]', current), 'd')
    current.context = { user: { name: 'Lin' } }
    current.input = { id: 'job-3' }
    current.data = { items: ['e', 'f'] }
    assert.equal(resolveValue('$context.user.name', current), 'Lin')
    assert.equal(resolveValue('$input.id', current), 'job-3')
    assert.equal(resolveValue('$data.items[1]', current), 'f')
    for (let index = 0; index < 1_025; index += 1) {
      assert.equal(resolveValue(`$input.item${index}`, current), undefined)
    }
    assert.equal(resolveValue('$context.user.name', current), 'Lin')
  })

  it('returns scalars and functions unchanged', () => {
    assert.equal(resolveValue('literal', scope), 'literal')
    assert.equal(resolveValue('literal', scope), 'literal')
    assert.equal(resolveValue(42, scope), 42)
    assert.equal(resolveValue(false, scope), false)
    assert.equal(resolveValue(null, scope), null)

    const fn = (): void => undefined

    assert.equal(resolveValue(fn, scope), fn)
  })

  it('resolves variables and fails when one is missing', () => {
    assert.deepEqual(resolveValue('$variables', scope), scope.variables)
    assert.equal(resolveValue('$variables.SECRET', scope), 's3cr3t')
    for (const strategy of ['first', 'second']) {
      assert.throws(
        () => resolveValue('$variables.MISSING', { ...scope, strategy, configPath: `strategies.${strategy}.props` }),
        (error: unknown) => {
          assert.ok(error instanceof ResolutionError)
          assert.equal(error.slapError.strategy, strategy)
          assert.equal(error.slapError.path, `strategies.${strategy}.props`)
          return true
        }
      )
    }
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

  it('resolves escaped template delimiters and backslashes', () => {
    const cases = [
      ['\\${NAME}', '${NAME}'],
      ['\\{{ user.name }}', '{{ user.name }}'],
      ['\\\\${NAME}', '\\Ada'],
      ['\\\\\\${NAME}', '\\${NAME}'],
      ['${NAME} \\${NAME}', 'Ada ${NAME}'],
      ['\\${BROKEN', '${BROKEN'],
      ['\\x', '\\x'],
      ['\\\\', '\\'],
      ['', ''],
      ['\\${A} ${NAME} \\{{ user.name }} {{ user.name }}', '${A} Ada {{ user.name }} '],
    ]

    for (const [template, value] of cases) {
      assert.equal(resolveValue({ $template: template }, scope), value)
    }
  })

  it('resolves nested objects and arrays recursively', () => {
    assert.deepEqual(resolveValue({ id: '$input.id', list: ['$data.count', '$context.user.name'] }, scope), {
      id: 'job-1',
      list: [2, 'Ada'],
    })
  })

  it('preserves literal keys and does not resolve referenced objects a second time', () => {
    const payload = { literal: '$variables.MISSING' }
    const raw = {
      'literal.key': '$input.id',
      'items[0]': '$data.count',
      '': '$context.user.name',
      ['__proto__']: '$data.count',
      reference: '$input.payload',
      expression: { $expression: ['property', '$input', 'payload'] },
    }
    const resolved = resolveValue(raw, { ...scope, input: { id: 'job-1', payload } })

    assert.deepEqual(resolved, {
      'literal.key': 'job-1',
      'items[0]': 2,
      '': 'Ada',
      ['__proto__']: 2,
      reference: payload,
      expression: payload,
    })
    assert.ok(resolved !== null && typeof resolved === 'object' && 'reference' in resolved && 'expression' in resolved)
    assert.equal(resolved.reference, payload)
    assert.equal(resolved.expression, payload)
    assert.equal(Object.getPrototypeOf(resolved), Object.prototype)
    assert.equal(raw['literal.key'], '$input.id')
  })
})

describe('nested props traversal', () => {
  it('reads values in order while keeping the initial literal keys', () => {
    const raw: Record<string, unknown> = { first: 1, second: '$input.id', third: 3 }
    const seen: (string | number)[] = []
    let resolved: unknown

    Object.defineProperty(raw, 'first', {
      enumerable: true,
      get: () => {
        seen.push('first')
        raw.second = 2
        delete raw.third
        raw.later = 4
        return 1
      },
    })
    resolved = resolveValue(raw, scope)
    assert.deepEqual(seen, ['first'])
    assert.deepEqual(resolved, { first: 1, second: 2, third: undefined })
  })

  it('propagates getter failures before reading later fields', () => {
    const failure = new Error('getter failure')
    const raw = {
      get first(): never {
        throw failure
      },
      get later() {
        return assert.fail('later getter was read')
      },
    }

    assert.throws(
      () => resolveValue(raw, scope),
      (cause) => cause === failure
    )
  })
})

describe('resolved dictionary properties', () => {
  it('creates own data properties without invoking inherited setters', () => {
    const key = 'slapflow-resolver-test-setter'
    const raw = { [key]: '$input.id' }
    let resolved: unknown

    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      set: () => {
        assert.fail('inherited setter was called')
      },
    })
    try {
      resolved = resolveValue(raw, scope)
      assert.deepEqual(Object.getOwnPropertyDescriptor(resolved, key), {
        value: 'job-1',
        enumerable: true,
        configurable: true,
        writable: true,
      })
      assert.equal(Object.getPrototypeOf(resolved), Object.prototype)
    } finally {
      Reflect.deleteProperty(Object.prototype, key)
    }
  })
})

describe('cached template resolution', () => {
  it('reads current values and checks current field types with cached syntax', () => {
    const template = { $template: '${BASE}/{{ context.id }}/{{ input.id }}/{{ data.count }}' }
    const current = {
      context: { id: 'first' },
      input: { id: 'one' },
      data: { count: 1 },
      variables: { BASE: 'https://first.test' },
      types: { id: 'string' as const },
    }

    assert.equal(resolveValue(template, current), 'https://first.test/first/one/1')
    current.context.id = 'second'
    current.input.id = 'two'
    current.data.count = 2
    current.variables.BASE = 'https://second.test'
    assert.equal(resolveValue(template, current), 'https://second.test/second/two/2')
    assert.equal(
      codeOf(() => resolveValue(template, { ...current, context: { id: 3 } })),
      'TYPE_MISMATCH'
    )
  })

  it('creates fresh diagnostics for cached invalid syntax and missing variables', () => {
    for (const template of ['{{ cached-invalid', '${CACHE_MISSING}']) {
      const errors: ResolutionError[] = []

      for (const strategy of ['first', 'second']) {
        try {
          resolveValue(
            { $template: template },
            { context: {}, input: {}, data: {}, strategy, configPath: `${strategy}.props.url` }
          )
        } catch (cause) {
          if (cause instanceof ResolutionError) {
            errors.push(cause)
          } else {
            throw cause
          }
        }
      }
      assert.equal(errors.length, 2)
      assert.notEqual(errors[0], errors[1])
      assert.equal(errors[0]?.slapError.strategy, 'first')
      assert.equal(errors[1]?.slapError.strategy, 'second')
      assert.equal(errors[0]?.slapError.path, 'first.props.url')
      assert.equal(errors[1]?.slapError.path, 'second.props.url')
    }
  })
})
