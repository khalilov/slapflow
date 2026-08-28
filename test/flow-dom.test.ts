import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createFlow } from '~/index'

type Context = Record<string, never>

class FakeElement {
  dataset = { orderId: '42' }
  value = 'save'

  closest(selector: string): FakeElement | null {
    return selector === 'form' ? null : this
  }
}

class FakeRoot {
  private listeners = new Map<string, EventListener>()

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener)
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type)
  }

  dispatch(type: string, target: FakeElement): { prevented: boolean; stopped: boolean } {
    let prevented = false
    let stopped = false
    this.listeners.get(type)?.({
      type,
      target,
      preventDefault: () => {
        prevented = true
      },
      stopPropagation: () => {
        stopped = true
      },
    } as unknown as Event)
    return { prevented, stopped }
  }
}

describe('flow DOM bindings', () => {
  it('delegates DOM events and builds the default input', () => {
    const originalElement = globalThis.Element
    const originalHtmlElement = globalThis.HTMLElement
    Object.defineProperty(globalThis, 'Element', { configurable: true, value: FakeElement })
    Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: FakeElement })

    try {
      const root = new FakeRoot()
      const inputs: unknown[] = []
      const chain = createFlow<Context>(
        {
          actions: {
            save: ({ input }) => {
              inputs.push(input)
            },
          },
          events: {
            '[dom] .save:click': { entrypoint: 'save' },
          },
          config: {
            entrypoints: { save: 'save' },
            strategies: { save: { fn: 'save' } },
          },
        },
        { context: {}, root: root as unknown as Element }
      )

      const started = chain.start()
      const event = root.dispatch('click', new FakeElement())

      assert.deepEqual(started.active, ['[dom] .save:click'])
      assert.deepEqual(inputs, [{ type: 'click', value: 'save', dataset: { orderId: '42' } }])
      assert.deepEqual(event, { prevented: false, stopped: false })
    } finally {
      Object.defineProperty(globalThis, 'Element', { configurable: true, value: originalElement })
      Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: originalHtmlElement })
    }
  })

  it('marks DOM bindings inactive when no DOM root is available', () => {
    const chain = createFlow<Context>(
      {
        events: { '[dom] .save:click': { entrypoint: 'save' } },
        config: {
          entrypoints: { save: 'save' },
          strategies: { save: { fn: 'core.noop' } },
        },
      },
      { context: {} }
    )

    const started = chain.start()

    assert.deepEqual(started.active, [])
    assert.deepEqual(started.inactive, [{ binding: '[dom] .save:click', reason: 'dom-unavailable' }])
  })
})
