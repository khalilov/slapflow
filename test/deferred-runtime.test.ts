import { strict } from 'node:assert'
import { describe, expect, it, vi } from 'vitest'
import { createRunner } from '~/createRunner'
import { createRuntime } from '~/helpers/runner/createRuntime'
import { type TraceSink } from '~/types'

vi.mock('~/helpers/runner/createRuntime', { spy: true })

describe('deferred action runtime', () => {
  it.each([false, true, { push: () => undefined } satisfies TraceSink])(
    'preserves traced execution and defers builtin skips with trace=%s',
    (trace) => {
      const runner = createRunner({ trace })

      runner.loadConfig({
        strategies: { root: { fn: 'core.noop', when: ['and', ['truthy', true], ['not', ['truthy', true]]] } },
      })
      vi.mocked(createRuntime).mockClear()

      strict.equal(runner.runSync('root', {}).status, 'skipped')
      expect(createRuntime).toHaveBeenCalledTimes(trace === false ? 0 : 1)
    }
  )

  it('preserves custom condition runtime identity and dynamic registration', () => {
    const runner = createRunner()
    const captured: unknown[] = []

    runner.loadConfig({ strategies: { root: { fn: 'capture', when: ['and', ['truthy', true], ['custom']] } } })
    runner.registerAction('capture', ({ runtime }) => {
      strict.equal(runtime, captured[0])
      strict.equal(runtime.data.get('value'), 7)
    })
    runner.registerCondition('custom', ({ runtime }) => {
      captured.push(runtime)
      runtime.data.set('value', 7)
      return true
    })
    vi.mocked(createRuntime).mockClear()

    strict.equal(runner.runSync('root', {}).status, 'success')
    expect(createRuntime).toHaveBeenCalledTimes(1)
  })

  it('keeps retained action helpers attached to current state after executeThen', async () => {
    const runner = createRunner()
    let result: Awaited<ReturnType<typeof runner.run>>

    runner.registerAction('parent', async ({ runtime }) => {
      await runtime.executeThen()
      strict.equal(runtime.data.get('value'), 7)
      runtime.data.set('after', true)
      return { continue: false }
    })
    runner.registerAction('child', () => ({ data: { value: 7 } }))
    runner.loadConfig({
      strategies: {
        root: { fn: 'parent', when: ['truthy', true], then: ['child'] },
        child: { fn: 'child' },
      },
    })
    vi.mocked(createRuntime).mockClear()

    result = await runner.run('root', {})

    strict.equal(result.status, 'success')
    strict.deepEqual(result.data, { value: 7, after: true })
    expect(createRuntime).toHaveBeenCalledTimes(2)
  })

  it('does not construct an action runtime for a skipped inline transition', () => {
    const runner = createRunner()

    runner.loadConfig({
      strategies: {
        root: {
          fn: 'core.selector',
          mode: 'selector',
          then: [{ strategy: 'child', when: ['truthy', false] }, 'child'],
        },
        child: { fn: 'core.noop' },
      },
    })
    vi.mocked(createRuntime).mockClear()

    strict.equal(runner.runSync('root', {}).status, 'success')
    expect(createRuntime).toHaveBeenCalledTimes(2)
  })
})
