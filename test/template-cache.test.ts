import { strict } from 'node:assert'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseTemplate } from '~/helpers/path/parseTemplate'
import { parseTemplateSyntax } from '~/helpers/path/parseTemplateSyntax'

vi.mock('~/helpers/path/parseTemplateSyntax', { spy: true })

describe('template syntax cache', () => {
  beforeEach(() => {
    vi.mocked(parseTemplateSyntax).mockClear()
  })
  it('reuses immutable syntax for valid and invalid strings', () => {
    const template = '${CACHE_TEST_BASE}/cached/{{ context.id }}'
    const parsed = parseTemplate(template)
    const invalid = parseTemplate('{{ cache-test-invalid')

    strict.equal(parseTemplate(template), parsed)
    strict.equal(parseTemplate('{{ cache-test-invalid'), invalid)
    strict.equal(Object.isFrozen(parsed), true)
    strict.equal(Object.isFrozen(invalid), true)
    strict.equal(invalid.ok, false)
    if (parsed.ok) {
      strict.equal(Object.isFrozen(parsed.parts), true)
      strict.equal(parsed.parts.every(Object.isFrozen), true)
    }
    expect(parseTemplateSyntax).toHaveBeenCalledTimes(2)
  })

  it('evicts old syntax instead of retaining every unique string', () => {
    const first = parseTemplate('cache-eviction-first')

    for (let index = 0; index < 1024; index += 1) {
      parseTemplate(`cache-eviction-${index}`)
    }
    vi.mocked(parseTemplateSyntax).mockClear()

    strict.notEqual(parseTemplate('cache-eviction-first'), first)
    expect(parseTemplateSyntax).toHaveBeenCalledTimes(1)
  })
})
