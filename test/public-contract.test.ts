import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'vitest'
import { createBuiltinActions } from '~/builtins/actions'
import { createBuiltinConditions } from '~/builtins/conditions'
import { createRunner } from '~/createRunner'
import {
  defineConfig,
  createMemoryTraceSink,
  BUILTIN_ACTIONS,
  BUILTIN_CONDITIONS,
  type Action,
  type ConditionFn,
  type RunResult,
  type Runtime,
} from '~/index'

type Ctx = {
  count: number
}

describe('public contract', () => {
  it('allows legacy runtime mocks without variables', () => {
    const runtime = {
      get: (_path: string) => undefined,
      set: () => undefined,
      data: { get: () => undefined, set: () => undefined },
      getData: () => undefined,
      setData: () => undefined,
      resolve: (value: unknown) => value,
      signal: new AbortController().signal,
      executeThen: async () => ({ status: 'success' as const }),
      executeCatch: async () => undefined,
      emit: () => undefined,
      patch: () => undefined,
      stop: () => ({ type: 'stop' as const }),
      fail: () => ({ type: 'fail' as const }),
    } satisfies Runtime

    assert.equal(runtime.get('missing'), undefined)
  })

  it('exports the root api and public types used by consumers', async () => {
    const action: Action<Ctx, string> = ({ context }) => ({ patch: String(context.count) })
    const condition: ConditionFn<Ctx> = ({ context }) => context.count > 0
    const runner = createRunner<Ctx, string>({ trace: createMemoryTraceSink() })
    const config = { strategies: {} }

    runner.registerAction('custom.patch', action)
    runner.registerCondition('custom.allowed', condition)
    runner.loadConfig({
      strategies: {
        root: { fn: 'custom.patch', when: ['custom.allowed'] },
      },
    })

    const result: RunResult<Ctx, string> = await runner.run('root', { count: 2 })

    assert.deepEqual(result.patches, ['2'])
    assert.equal(new Map(BUILTIN_ACTIONS).has('core.noop'), true)
    assert.equal(new Map(BUILTIN_CONDITIONS).has('eq'), true)
    assert.equal(defineConfig(config), config)
  })

  it('keeps spec built-in action names synchronized with implementation', async () => {
    const spec = await readFile('SPEC.md', 'utf8')

    for (const name of Object.keys(createBuiltinActions<unknown, unknown>())) {
      assert.equal(spec.includes(`| \`${name}\``), true, `${name} is missing from SPEC.md`)
    }
  })

  it('keeps spec built-in condition names synchronized with implementation', async () => {
    const spec = await readFile('SPEC.md', 'utf8')

    for (const name of Object.keys(createBuiltinConditions<unknown>())) {
      assert.equal(spec.includes(`- \`${name}\``) || spec.includes(`\`${name}\``), true, `${name} is missing from spec`)
    }
  })
})
