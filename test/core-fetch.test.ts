import assert from 'node:assert/strict'
import { afterEach, describe, it, vi } from 'vitest'
import { createRunner } from '~/runner'

const runFetch = async (props: Record<string, unknown>, signal?: AbortSignal) => {
  const runner = createRunner()

  runner.loadConfig({ strategies: { root: { fn: 'core.fetch', props } } })

  return runner.run('root', {}, {}, signal ? { signal } : {})
}

describe('core.fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards credentials to native fetch', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => new Response(null, { status: 204 }))

    vi.stubGlobal('fetch', fetch)

    const result = await runFetch({ url: 'https://api.example.test/account', credentials: 'include', response: 'none' })

    assert.equal(result.status, 'success')
    assert.equal(fetch.mock.calls[0]?.[1]?.credentials, 'include')
  })

  it('skips an aborted request', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => {
      throw new Error('aborted')
    })

    controller.abort()
    vi.stubGlobal('fetch', fetch)

    const result = await runFetch({ url: 'https://api.example.test/account' }, controller.signal)

    assert.equal(result.status, 'skipped')
  })

  it('does not retry a response parsing failure', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => new Response('not json', { status: 200 }))

    vi.stubGlobal('fetch', fetch)

    const result = await runFetch({ url: 'https://api.example.test/account', retry: { maxAttempts: 2 } })

    assert.equal(result.status, 'failed')
    assert.equal(fetch.mock.calls.length, 1)
  })
})
