import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, it } from 'vitest'
import { createBuiltinActions } from '~/builtins/actions'
import { createBuiltinConditions } from '~/builtins/conditions'

describe('public contract', () => {
  it('loads and runs the built package through ESM and CommonJS exports', async () => {
    const packageName = 'slapflow'
    const modules = [await import(packageName), createRequire(import.meta.url)(packageName)]

    for (const api of modules) {
      const context = { amount: 3 }
      const flow = api.createFlow(
        { config: { strategies: { root: { fn: 'core.patch', props: { patch: 'ok' } } } } },
        { context }
      )
      const { validation } = flow.start()
      const result = flow.runner.runSync('root', context)

      flow.stop()
      assert.equal(validation.ok, true)
      assert.deepEqual(result.patches, ['ok'])
      assert.deepEqual(api.evaluateCondition(['eq', '$context.amount', 3], { context }), { ok: true, matched: true })
      assert.deepEqual(api.evaluateExpression(['multiply', '$context.amount', 2], { context }), { ok: true, value: 6 })
    }
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
