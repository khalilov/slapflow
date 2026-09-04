import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/createRunner'
import { type Props } from '~/index'

type Context = Record<string, unknown>

const runProps = async (
  props: Props,
  options: Parameters<typeof createRunner<Context>>[0] = {},
  input: Record<string, unknown> = {}
) => {
  let received: Props = {}
  const runner = createRunner<Context>(options)

  runner.registerAction('capture', ({ props: actionProps }) => {
    received = actionProps
  })
  runner.loadConfig({ strategies: { root: { fn: 'capture', props } } })
  const result = await runner.run('root', {}, input)
  return { received, result }
}

describe('runtime variables and expressions', () => {
  it('resolves nested variables and preserves complete value types', async () => {
    const object = { price: 12, enabled: true }
    const array = [object]
    const variables = { SERVICES: { auth: { baseUrl: 'http://auth' } }, CONTRACTS: array, FLAG: false }

    const { received } = await runProps(
      {
        url: '$variables.SERVICES.auth.baseUrl',
        price: '$variables.CONTRACTS[0].price',
        contract: '$variables.CONTRACTS[0]',
        contracts: '$variables.CONTRACTS',
        flag: '$variables.FLAG',
      },
      { variables }
    )

    assert.equal(received.url, 'http://auth')
    assert.equal(received.price, 12)
    assert.deepEqual(received.contract, object)
    assert.deepEqual(received.contracts, array)
    assert.notEqual(received.contract, object)
    assert.notEqual(received.contracts, array)
    assert.equal(received.flag, false)
    assert.deepEqual(variables, { SERVICES: { auth: { baseUrl: 'http://auth' } }, CONTRACTS: array, FLAG: false })
  })

  it('interpolates multiple variables and fallbacks as strings', async () => {
    const { received } = await runProps(
      {
        url: { $template: '${AUTH_SERVICE_BASE}/auth/${VERSION}' },
        fallback: { $template: '${LOG_LEVEL:-info}' },
        numeric: { $template: '${PORT}' },
      },
      { variables: { AUTH_SERVICE_BASE: 'http://localhost', VERSION: 'v1', PORT: 7256 } }
    )
    assert.deepEqual(received, {
      url: 'http://localhost/auth/v1',
      fallback: 'info',
      numeric: '7256',
    })
  })

  it('reports missing variables without names or values', async () => {
    const { result } = await runProps({ secret: '$variables.SECRET_TOKEN' }, { variables: {} })
    assert.equal(result.status, 'failed')
    assert.deepEqual(
      {
        code: result.error?.code,
        strategy: result.error?.strategy,
        path: result.error?.path,
      },
      {
        code: 'VARIABLE_NOT_FOUND',
        strategy: 'root',
        path: 'strategies.root.props.secret',
      }
    )
    assert.equal(JSON.stringify(result.error).includes('SECRET_TOKEN'), false)
  })

  it('reports malformed templates at runtime', async () => {
    const { result } = await runProps({ value: { $template: '${1BAD}' } })
    assert.equal(result.error?.code, 'TEMPLATE_INVALID')
    assert.equal(result.error?.path, 'strategies.root.props.value')
  })

  it('resolves escaped template delimiters and backslashes', async () => {
    const { received } = await runProps(
      {
        escapedVariable: { $template: '\\${NAME}' },
        escapedData: { $template: '\\{{ user.name }}' },
        evenSlashes: { $template: '\\\\${NAME}' },
        oddSlashes: { $template: '\\\\\\${NAME}' },
        mixed: { $template: '${NAME} \\${NAME}' },
        escapedBroken: { $template: '\\${BROKEN' },
        unknownEscape: { $template: '\\x' },
        backslash: { $template: '\\\\' },
        empty: { $template: '' },
        multiple: { $template: '\\${A} ${NAME} \\{{ user.name }} {{ user.name }}' },
      },
      { variables: { NAME: 'Ada' } }
    )

    assert.deepEqual(received, {
      escapedVariable: '${NAME}',
      escapedData: '{{ user.name }}',
      evenSlashes: '\\Ada',
      oddSlashes: '\\${NAME}',
      mixed: 'Ada ${NAME}',
      escapedBroken: '${BROKEN',
      unknownEscape: '\\x',
      backslash: '\\',
      empty: '',
      multiple: '${A} Ada {{ user.name }} ',
    })
  })

  it('evaluates every arithmetic and numeric built-in', async () => {
    const expression = (operator: string, ...args: unknown[]) => ({ $expression: [operator, ...args] })

    const { received } = await runProps({
      add: expression('add', 1, 2, 3),
      subtract: expression('subtract', 7, 2),
      multiply: expression('multiply', 2, 3, 4),
      divide: expression('divide', 8, 2),
      modulo: expression('modulo', 7, 4),
      min: expression('min', 4, 2, 8),
      max: expression('max', 4, 2, 8),
      abs: expression('abs', -2),
      round: expression('round', 1.6),
      floor: expression('floor', 1.6),
      ceil: expression('ceil', 1.2),
      clamp: expression('clamp', 9, 1, 5),
    })
    assert.deepEqual(received, {
      add: 6,
      subtract: 5,
      multiply: 24,
      divide: 4,
      modulo: 3,
      min: 2,
      max: 8,
      abs: 2,
      round: 2,
      floor: 1,
      ceil: 2,
      clamp: 5,
    })
  })

  it('supports access, concat, nested expressions, and recursively resolved structures', async () => {
    const variables = { CONTRACTS: [{ price: 10 }, { price: 15 }], PREFIX: 'total=' }
    const { received } = await runProps(
      {
        selected: { $expression: ['at', '$variables.CONTRACTS', '$input.index'] },
        price: {
          $expression: ['property', { $expression: ['at', '$variables.CONTRACTS', '$input.index'] }, 'price'],
        },
        nested: {
          total: { $expression: ['multiply', { $expression: ['get', '$variables', 'CONTRACTS[1].price'] }, 2] },
        },
        text: { $expression: ['concat', '$variables.PREFIX', 30, true] },
        array: ['$variables.CONTRACTS[0].price', { value: '$variables.CONTRACTS[1].price' }],
      },
      { variables },
      { index: 1 }
    )
    assert.deepEqual(received, {
      selected: variables.CONTRACTS[1],
      price: 15,
      nested: { total: 30 },
      text: 'total=30true',
      array: [10, { value: 15 }],
    })
  })

  it('returns typed expression failures', async () => {
    const cases: Array<[Props, string]> = [
      [{ value: { $expression: ['add', '1', 2] } }, 'EXPRESSION_INVALID_ARGUMENT'],
      [{ value: { $expression: ['at', ['a'], 0, 'unexpected'] } }, 'EXPRESSION_INVALID_ARGUMENT'],
      [{ value: { $expression: ['divide', 1, 0] } }, 'EXPRESSION_DIVISION_BY_ZERO'],
      [{ value: { $expression: ['missing', 1] } }, 'EXPRESSION_OPERATOR_NOT_FOUND'],
      [{ value: { $expression: ['at', [], 0] } }, 'EXPRESSION_PATH_NOT_FOUND'],
    ]
    for (const [props, code] of cases) {
      const { result } = await runProps(props)
      assert.equal(result.error?.code, code)
      assert.equal(result.error?.strategy, 'root')
      assert.equal(result.error?.path, 'strategies.root.props.value')
    }
  })

  it('registers custom operators', async () => {
    const { received } = await runProps(
      { tax: { $expression: ['calculateTax', '$input.amount', '$variables.TAX_RATE'] } },
      {
        variables: { TAX_RATE: 0.2 },
        expressions: { calculateTax: ([amount, rate]) => (amount as number) * (rate as number) },
      },
      { amount: 100 }
    )
    assert.equal(received.tax, 20)
  })

  it('does not resolve inherited custom operators', async () => {
    const { result } = await runProps({ value: { $expression: ['toString'] } })
    assert.equal(result.error?.code, 'EXPRESSION_OPERATOR_NOT_FOUND')
  })

  it('reports custom operator failures without exposing their causes', async () => {
    const cause = new Error('secret-variable-value')
    const { result } = await runProps(
      { value: { $expression: ['calculate'] } },
      {
        expressions: {
          calculate: () => {
            throw cause
          },
        },
      }
    )
    assert.equal(result.error?.code, 'EXPRESSION_INVALID_ARGUMENT')
    assert.deepEqual(result.error?.cause, { type: 'Error' })
    assert.equal(JSON.stringify(result.error).includes('secret-variable-value'), false)
  })

  it('blocks prototype access through variables and expressions', async () => {
    const attempts: Array<[Props, string]> = [
      [{ value: '$variables.constructor' }, 'VARIABLE_NOT_FOUND'],
      [{ value: { $expression: ['property', {}, 'toString'] } }, 'EXPRESSION_PATH_NOT_FOUND'],
      [{ value: { $expression: ['get', {}, 'constructor.name'] } }, 'EXPRESSION_PATH_NOT_FOUND'],
    ]
    for (const [props, code] of attempts) {
      const { result } = await runProps(props, { variables: {} })
      assert.equal(result.error?.code, code)
    }
  })

  it('redacts variable-derived trace props and isolates runner registries', async () => {
    const first = createRunner<Context>({
      trace: true,
      variables: { SECRET: 'first-secret' },
      expressions: { identify: () => 'first' },
    })
    const second = createRunner<Context>({
      trace: true,
      variables: { SECRET: 'second-secret' },
      expressions: { identify: () => 'second' },
    })
    for (const runner of [first, second]) {
      runner.registerAction('noop', () => undefined)
      runner.loadConfig({
        strategies: {
          root: {
            fn: 'noop',
            props: {
              secret: '$variables.SECRET',
              derived: { $expression: ['concat', '$variables.SECRET', '-suffix'] },
              escaped: { $template: '\\${SECRET}' },
              identity: { $expression: ['identify'] },
            },
          },
        },
      })
    }
    const [a, b] = await Promise.all([first.run('root', {}), second.run('root', {})])
    assert.equal(JSON.stringify(a.trace).includes('first-secret'), false)
    assert.equal(JSON.stringify(b.trace).includes('second-secret'), false)
    assert.equal(a.trace?.[0]?.props.secret, '[REDACTED]')
    assert.equal(b.trace?.[0]?.props.secret, '[REDACTED]')
    assert.equal(a.trace?.[0]?.props.escaped, '${SECRET}')
    assert.equal(b.trace?.[0]?.props.escaped, '${SECRET}')
  })

  it('makes run variables read-only and isolates supplied objects', async () => {
    const supplied = { SETTINGS: { count: 0 } }
    const seen: number[] = []
    const runner = createRunner<Context>({ variables: supplied })
    runner.registerAction('mutate', async ({ props }) => {
      const settings = props.settings as { count: number }
      settings.count += 1
      await Promise.resolve()
      seen.push(settings.count)
    })
    runner.loadConfig({
      strategies: { root: { fn: 'mutate', props: { settings: '$variables.SETTINGS' } } },
    })
    const results = await Promise.all([runner.run('root', {}), runner.run('root', {})])
    assert.deepEqual(
      results.map(({ status }) => status),
      ['failed', 'failed']
    )
    assert.deepEqual(seen, [])
    assert.equal(supplied.SETTINGS.count, 0)
  })

  it('rejects mutable non-plain variable values', () => {
    class MutableValue {
      value = 1
    }
    const unsupported = [undefined, new Date(), new Map(), new Uint8Array([1]), new MutableValue()]
    for (const value of unsupported) {
      assert.throws(
        () => createRunner<Context>({ variables: { value } as never }),
        /only primitives, arrays, and plain objects/
      )
    }
  })

  it('rejects array accessors, symbols, and additional properties without reading them', () => {
    let getterWasRead = false
    const withGetter: unknown[] = []
    Object.defineProperty(withGetter, '0', {
      get: () => {
        getterWasRead = true
        return 'secret'
      },
      enumerable: true,
    })
    const withSymbol: unknown[] = []
    Object.defineProperty(withSymbol, Symbol('secret'), { value: true })
    const withProperty = Object.assign([], { extra: true })

    for (const value of [withGetter, withSymbol, withProperty]) {
      assert.throws(
        () => createRunner<Context>({ variables: { value } as never }),
        /only primitives, arrays, and plain objects/
      )
    }
    assert.equal(getterWasRead, false)
  })

  it('exposes read-only runtime variable access', async () => {
    let values: unknown[] = []
    const runner = createRunner<Context>({ variables: { nested: { value: 4 }, list: [7] } })
    runner.registerAction('read', ({ runtime }) => {
      values = [
        runtime.variables?.get('nested.value'),
        runtime.variables?.get('list[0]'),
        runtime.variables?.get('missing'),
        runtime.variables?.get('constructor'),
      ]
    })
    runner.loadConfig({ strategies: { root: { fn: 'read' } } })
    await runner.run('root', {})
    assert.deepEqual(values, [4, 7, undefined, undefined])
  })
})
