import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/createRunner'
import { type Action, type Config, type Runner, type SlapError, type ValidationResult } from '~/index'

type Ctx = {
  log?: string[]
}

type Harness = {
  runner: Runner<Ctx>
  errors: SlapError[]
  validation: ValidationResult
}

const setup = (config: Config, actions: Record<string, Action<Ctx>>): Harness => {
  const errors: SlapError[] = []
  const runner = createRunner<Ctx>({ onError: ({ error }) => errors.push(error) })

  runner.registerActions(actions)
  const validation = runner.loadConfig(config)

  return { runner, errors, validation }
}

describe('core.invoke', () => {
  it('passes props input to the invoked entrypoint', async () => {
    const seen: unknown[] = []
    const { runner } = setup(
      {
        entrypoints: { child: 'child.run' },
        strategies: {
          parent: { fn: 'core.invoke', props: { entrypoint: 'child', input: { colonyIds: ['c1', 'c2'] } } },
          'child.run': { fn: 'child.run' },
        },
      },
      { 'child.run': ({ input }) => void seen.push(input) }
    )

    await runner.run('parent', {})

    assert.deepEqual(seen, [{ colonyIds: ['c1', 'c2'] }])
  })

  it('runs then with the sub-run data merged into the parent data', async () => {
    const got: unknown[] = []
    const { runner } = setup(
      {
        entrypoints: { child: 'child.run' },
        strategies: {
          parent: { fn: 'core.invoke', props: { entrypoint: 'child' }, then: ['after'] },
          'child.run': { fn: 'child.run' },
          after: { fn: 'after', props: { value: '$data.value' } },
        },
      },
      {
        'child.run': () => ({ data: { value: 42 } }),
        after: ({ props }) => void got.push(props.value),
      }
    )

    const result = await runner.run('parent', {})

    assert.equal(result.status, 'success')
    assert.deepEqual(got, [42])
  })

  it('routes a failed sub-run into catch', async () => {
    const recovered: string[] = []
    const { runner, errors } = setup(
      {
        entrypoints: { child: 'child.fail' },
        strategies: {
          parent: { fn: 'core.invoke', props: { entrypoint: 'child' }, catch: ['recover'] },
          'child.fail': { fn: 'child.fail' },
          recover: { fn: 'recover' },
        },
      },
      {
        'child.fail': () => {
          throw new Error('boom')
        },
        recover: () => void recovered.push('yes'),
      }
    )

    const result = await runner.run('parent', {})

    assert.equal(result.status, 'success')
    assert.deepEqual(recovered, ['yes'])
    assert.equal(
      errors.some((error) => error.code === 'ACTION_THROWN'),
      true
    )
  })

  it('swallows a sub-run failure when neither then nor catch is declared', async () => {
    const { runner, errors } = setup(
      {
        entrypoints: { child: 'child.fail' },
        strategies: {
          parent: { fn: 'core.invoke', props: { entrypoint: 'child' } },
          'child.fail': { fn: 'child.fail' },
        },
      },
      {
        'child.fail': () => {
          throw new Error('boom')
        },
      }
    )

    const result = await runner.run('parent', {})

    assert.equal(result.status, 'success')
    assert.equal(
      errors.some((error) => error.code === 'ACTION_THROWN'),
      true
    )
  })

  it('honours the invoke strategy mode for its then branch', async () => {
    const order: string[] = []
    const { runner } = setup(
      {
        entrypoints: { child: 'child.run' },
        strategies: {
          parent: { fn: 'core.invoke', mode: 'selector', props: { entrypoint: 'child' }, then: ['first', 'second'] },
          'child.run': { fn: 'child.run' },
          first: { fn: 'first', when: ['truthy', '$data.ready'] },
          second: { fn: 'second' },
        },
      },
      {
        'child.run': () => undefined,
        first: () => void order.push('first'),
        second: () => void order.push('second'),
      }
    )

    await runner.run('parent', {})

    assert.deepEqual(order, ['second'])
  })

  it('stops recursive invoke at maxSpawnDepth', async () => {
    const { runner, errors } = setup(
      {
        entrypoints: { recur: 'recur' },
        strategies: { recur: { fn: 'core.invoke', props: { entrypoint: 'recur' } } },
      },
      {}
    )

    const result = await runner.run('recur', {})

    assert.equal(result.status, 'success')
    assert.equal(
      errors.some((error) => error.code === 'MAX_SPAWN_DEPTH'),
      true
    )
  })

  it('warns when a literal invoke target is not defined', () => {
    const { validation } = setup({ strategies: { parent: { fn: 'core.invoke', props: { entrypoint: 'ghost' } } } }, {})

    assert.equal(validation.ok, true)
    assert.equal(
      validation.warnings.some((warning) => warning.code === 'INVOKE_ENTRYPOINT_NOT_FOUND'),
      true
    )
  })

  it('warns when an inline props override replaces the invoke target', () => {
    const { validation } = setup(
      {
        entrypoints: { real: 'child.run' },
        strategies: {
          parent: { fn: 'core.noop', then: [{ strategy: 'invoke', props: { entrypoint: 'ghost' } }] },
          invoke: { fn: 'core.invoke', props: { entrypoint: 'real' } },
          'child.run': { fn: 'child.run' },
        },
      },
      { 'child.run': () => undefined }
    )

    assert.equal(validation.ok, true)
    assert.equal(
      validation.warnings.some((warning) => warning.code === 'INVOKE_ENTRYPOINT_NOT_FOUND'),
      true
    )
  })

  it('accepts an inline invoke override that points at a defined target', () => {
    const { validation } = setup(
      {
        entrypoints: { real: 'child.run' },
        strategies: {
          parent: { fn: 'core.noop', then: [{ strategy: 'invoke', props: { entrypoint: 'real' } }] },
          invoke: { fn: 'core.invoke' },
          'child.run': { fn: 'child.run' },
        },
      },
      { 'child.run': () => undefined }
    )

    assert.equal(validation.ok, true)
    assert.equal(
      validation.warnings.some((warning) => warning.code === 'INVOKE_ENTRYPOINT_NOT_FOUND'),
      false
    )
  })

  it('fails when the entrypoint prop is missing', async () => {
    const { runner } = setup({ strategies: { bad: { fn: 'core.invoke' } } }, {})

    const result = await runner.run('bad', {})

    assert.equal(result.status, 'failed')
    assert.match(result.error?.message ?? '', /entrypoint/)
  })
})
