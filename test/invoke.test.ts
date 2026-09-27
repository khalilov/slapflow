import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRunner } from '~/createRunner'
import { type Action, type Config } from '~/index'

type Ctx = {
  log?: string[]
}

const setup = (config: Config, actions: Record<string, Action<Ctx>>) => {
  const runner = createRunner<Ctx>()

  runner.registerActions(actions)

  return { runner, validation: runner.loadConfig(config) }
}

describe('core.invoke', () => {
  it('runs then once per array element with the element as input', async () => {
    const seen: unknown[] = []
    const { runner, validation } = setup(
      {
        strategies: {
          loop: { fn: 'core.invoke', props: { items: ['a', 'b'] }, then: ['handle'] },
          handle: { fn: 'handle', props: { value: '$input' } },
        },
      },
      { handle: ({ props }) => void seen.push(props.value) }
    )

    const result = await runner.run('loop', {})

    assert.equal(validation.ok, true)
    assert.equal(result.status, 'success')
    assert.deepEqual(seen, ['a', 'b'])
  })

  it('iterates object values', async () => {
    const seen: unknown[] = []
    const { runner } = setup(
      {
        strategies: {
          loop: { fn: 'core.invoke', props: { items: { first: 'a', second: 'b' } }, then: ['handle'] },
          handle: { fn: 'handle' },
        },
      },
      { handle: ({ input }) => void seen.push(input) }
    )

    const result = await runner.run('loop', {})

    assert.equal(result.status, 'success')
    assert.deepEqual(seen, ['a', 'b'])
  })

  it('routes non-iterable items into catch', async () => {
    const recovered: string[] = []
    const { runner } = setup(
      {
        strategies: {
          loop: { fn: 'core.invoke', props: { items: 5 }, catch: ['recover'] },
          recover: { fn: 'recover' },
        },
      },
      { recover: () => void recovered.push('yes') }
    )

    const result = await runner.run('loop', {})

    assert.equal(result.status, 'success')
    assert.deepEqual(recovered, ['yes'])
  })

  it('does nothing for an empty collection', async () => {
    let calls = 0
    const { runner } = setup(
      {
        strategies: {
          loop: { fn: 'core.invoke', props: { items: [] }, then: ['handle'] },
          handle: { fn: 'handle' },
        },
      },
      { handle: () => void (calls += 1) }
    )

    const result = await runner.run('loop', {})

    assert.equal(result.status, 'success')
    assert.equal(calls, 0)
  })

  it('continues after an iteration handled by the leaf catch', async () => {
    const seen: unknown[] = []
    const { runner } = setup(
      {
        strategies: {
          loop: { fn: 'core.invoke', props: { items: ['a', 'b', 'c'] }, then: ['handle'] },
          handle: { fn: 'handle', catch: ['recover'] },
          recover: { fn: 'recover' },
        },
      },
      {
        handle: ({ input }) => {
          const value = input as unknown

          if (value === 'b') {
            throw new Error('boom')
          }
          seen.push(value)
        },
        recover: () => void seen.push('recover'),
      }
    )

    const result = await runner.run('loop', {})

    assert.equal(result.status, 'success')
    assert.deepEqual(seen, ['a', 'recover', 'c'])
  })
})
