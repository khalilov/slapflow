import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { createFlow, tools, type Action, type Tools } from '~/index'

type Context = {
  records: Record<string, { count: number }>
  pending?: boolean
  counts?: Record<string, number>
}

describe('tools in actions', () => {
  it('provides the shared frozen toolkit in synchronous and asynchronous runs', async () => {
    const context: Context = { records: { 'literal.key': { count: 3 } }, pending: true }
    const seen: Tools[] = []
    const action: Action<Context> = ({ context, tools }) => {
      seen.push(tools)
      context.counts = tools.map(context.records, (_key, { count }) => count * 2, { shallow: true })
      tools.flush(context, 'pending')
    }
    const flow = createFlow(
      { config: { strategies: { root: { fn: 'prepare' } } }, actions: { prepare: action } },
      { context }
    )
    const { validation } = flow.start()
    const sync = flow.runner.runSync('root', context)
    const async = await flow.runner.run('root', context)

    flow.stop()
    assert.equal(validation.ok, true)
    assert.equal(sync.status, 'success')
    assert.equal(async.status, 'success')
    assert.deepEqual(context.counts, { 'literal.key': 6 })
    assert.equal(Object.hasOwn(context, 'pending'), false)
    assert.deepEqual(seen, [tools, tools])
    assert.equal(seen[0], seen[1])
    assert.equal(Object.isFrozen(tools), true)
    assert.throws(() => Object.defineProperty(tools, 'map', { value: () => undefined }), TypeError)
  })

  it('routes toolkit exceptions through catch and preserves their original cause', () => {
    const context = Object.defineProperty({}, 'locked', { value: true, configurable: false })
    const errors: unknown[] = []
    const seen: Tools[] = []
    const flow = createFlow(
      {
        config: {
          strategies: {
            root: { fn: 'remove', catch: ['recover'] },
            recover: { fn: 'recover' },
          },
        },
        actions: {
          remove: ({ context, tools: { flush } }) => {
            flush(context, 'locked')
          },
          recover: ({ tools, runtime }) => {
            seen.push(tools)
            runtime.patch('recovered')
          },
        },
      },
      {
        context,
        onError: ({ error: { cause } }) => {
          errors.push(cause)
        },
      }
    )
    const { validation } = flow.start()
    const result = flow.runner.runSync('root', context)

    flow.stop()
    assert.equal(validation.ok, true)
    assert.equal(result.status, 'success')
    assert.deepEqual(result.patches, ['recovered'])
    assert.equal(seen[0], tools)
    assert.equal(errors.length, 1)
    assert.ok(errors[0] instanceof TypeError)
  })

  it('provides the same toolkit to parallel and invoked child actions', async () => {
    const seen: Tools[] = []
    const context = {}
    const flow = createFlow(
      {
        config: {
          strategies: {
            parallel: { fn: 'core.parallel', mode: 'parallel', then: ['left', 'right'] },
            left: { fn: 'capture' },
            right: { fn: 'capture' },
            invoke: { fn: 'core.invoke', props: { items: [1, 2] }, then: ['left'] },
          },
        },
        actions: {
          capture: async ({ tools, runtime }) => {
            await Promise.resolve()
            seen.push(tools)
            runtime.patch(tools.pick({ ready: true }, 'ready'))
          },
        },
      },
      { context }
    )
    const { validation } = flow.start()
    const parallel = await flow.runner.run('parallel', context)
    const invoked = await flow.runner.run('invoke', context)

    flow.stop()
    assert.equal(validation.ok, true)
    assert.deepEqual(parallel.patches, [true, true])
    assert.deepEqual(invoked.patches, [true, true])
    assert.equal(seen.length, 4)
    assert.equal(
      seen.every((value) => value === tools),
      true
    )
  })

  it('keeps raw object operations distinct from writes to a finished runtime', () => {
    const context = { value: 1, raw: 1 }
    const pending: Array<() => void> = []
    const flow = createFlow(
      {
        config: { strategies: { root: { fn: 'capture' } } },
        actions: {
          capture: ({ context, tools: { set }, runtime }) => {
            pending.push(() => {
              runtime.set('value', 2)
              set(context, 'raw', 2)
            })
          },
        },
      },
      { context }
    )
    const { validation } = flow.start()
    const result = flow.runner.runSync('root', context)

    flow.stop()
    pending[0]?.()
    assert.equal(validation.ok, true)
    assert.equal(result.status, 'success')
    assert.deepEqual(context, { value: 1, raw: 2 })
  })
})
