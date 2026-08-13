# CFB — Chain Functions Behavior

When the same business flow can start from a form, an API route, a job, or a WebSocket message, its control flow tends to spread across the application. CFB gives that flow one explicit home: a chain of ordinary TypeScript functions.

[![bundle size](https://img.shields.io/bundlephobia/minzip/chain-functions-behavior?label=bundle%20size)](https://bundlephobia.com/package/chain-functions-behavior)
[![Socket security](https://socket.dev/api/badge/npm/package/chain-functions-behavior/1.6.1)](https://socket.dev/npm/package/chain-functions-behavior/overview/1.6.1)

CFB takes care of orchestration, concurrency, cancellation, and diagnostics. Your application keeps ownership of its domain state and side effects.

## Why use it?

- **Keep the business flow visible.** Put a scenario in one chain instead of hiding it among UI handlers, transport callbacks, and service code.
- **Test the scenario without the surrounding application.** Pass in context and events; actions and conditions are just TypeScript functions.
- **Make async behavior deliberate.** Choose `parallel`, `latest`, `queue`, or `drop` for each event source. Actions receive an `AbortSignal` when cancellation matters.
- **Use the same flow in more than one place.** The chain can start from a typed bus, DOM event, API callback, timer, worker, or WebSocket message.

## Installation

```bash
npm install chain-functions-behavior
```

## Quick start

This example handles an order submission from a typed event bus. The `latest` mode cancels a previous submission for the same order when a newer event arrives.

```ts
import { createChainBehavior, createPubSubBehavior } from 'chain-functions-behavior'

type Context = {
  orders: Map<string, { id: string; status: 'draft' | 'submitted' }>
}

type Events = {
  'order.submit': { orderId: string }
}

const bus = createPubSubBehavior<Events>()
const context: Context = {
  orders: new Map([['order-1', { id: 'order-1', status: 'draft' }]]),
}

const behavior = createChainBehavior<Context, unknown, Events>(
  {
    events: {
      '[bus] order.submit': {
        entrypoint: 'order.submit',
        options: {
          concurrency: {
            mode: 'latest',
            key: ({ orderId }) => orderId,
          },
        },
      },
    },
    actions: {
      'order.submit': ({ context, input }) => {
        const order = context.orders.get(input.orderId as string)

        if (order) {
          order.status = 'submitted'
        }
      },
    },
    config: {
      entrypoints: { 'order.submit': 'order.submit' },
      strategies: { 'order.submit': { fn: 'order.submit' } },
    },
  },
  { bus, context }
)

behavior.start()
bus.emit('order.submit', { orderId: 'order-1' }, { origin: 'api' })
```

## Fetch data with cancellation and retries

`core.fetch` uses the run `AbortSignal`, retries transient failures, and keeps the response available to the next strategy without coupling the flow to a specific HTTP client.

```ts
const config = {
  strategies: {
    'catalog.load': {
      fn: 'core.fetch',
      props: {
        url: '/api/catalog',
        response: 'json',
        dataPath: 'catalogResponse',
        retry: { maxAttempts: 2, initialDelay: 250, maxDelay: 1_000 },
      },
      then: ['catalog.apply'],
    },
    'catalog.apply': { fn: 'catalog.apply' },
  },
}

const applyCatalog = ({ runtime }) => {
  const { body } = runtime.data.get('catalogResponse')

  // Update your application state with body.
}
```

## Route branches with compound conditions

Every `then` and `catch` target can have its own condition. Combine built-in conditions with `and`, `or`, and `not` to keep branching in the graph:

```ts
const config = {
  strategies: {
    'catalog.load': {
      fn: 'core.fetch',
      props: {
        url: '/api/catalog',
        response: 'json',
        dataPath: 'catalogResponse',
      },
      then: [
        {
          strategy: 'catalog.apply',
          when: [
            'and',
            ['typeIs', '$data.catalogResponse.body', 'record'],
            ['typeIs', '$data.catalogResponse.body.items', 'array'],
            ['not', ['empty', '$data.catalogResponse.body.items']],
          ],
        },
        {
          strategy: 'catalog.showEmpty',
          when: ['or', ['missing', '$data.catalogResponse.body.items'], ['empty', '$data.catalogResponse.body.items']],
        },
      ],
      catch: [
        {
          strategy: 'catalog.queueRetry',
          when: ['and', ['falsy', '$context.network.online'], ['includes', ['startup', 'refresh'], '$input.source']],
        },
        {
          strategy: 'catalog.showError',
          when: ['or', ['truthy', '$context.network.online'], ['eq', '$input.source', 'manual']],
        },
      ],
    },
    'catalog.apply': { fn: 'catalog.apply' },
    'catalog.showEmpty': { fn: 'catalog.showEmpty' },
    'catalog.queueRetry': { fn: 'catalog.queueRetry' },
    'catalog.showError': { fn: 'catalog.showError' },
  },
}
```

[View the execution flow](examples/compound-conditions.mmd).

## What CFB provides

- Declarative strategies, conditions, error branches, and entrypoints.
- A broad set of [built-in conditions](SPEC.md#built-in-conditions) for comparisons, type checks, collections, and compound logic.
- Typed PubSub bindings and delegated DOM bindings.
- `parallel`, `latest`, `queue`, and `drop` concurrency modes with per-entity lanes.
- A WebSocket bridge for forwarding selected bus events.
- `core.fetch` with response parsing, cancellation, and retry backoff.
- Normalized results, execution trace, validation, and lifecycle diagnostics such as `cfb.run.started` and `cfb.run.failed`.
- Runtime variables for configuration values, templates, and expressions.

## Where to go next

- Explore the runnable [client/server Todo app example](examples/todo-app), which sends a form request to a server CFB runtime for validation and in-memory storage.
- Read the complete [technical specification](SPEC.md) for the runner API, built-in actions and conditions, expressions, validation, safety limits, transport behavior, and lifecycle semantics.
- Russian documentation: [README-RU.md](README-RU.md) and [SPEC-RU.md](SPEC-RU.md).

## Development

```bash
npm test
npm run build
npm run pack:check
```
