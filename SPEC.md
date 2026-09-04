# Slapflow Specification

`slapflow` is an npm package for declaratively executing synchronous and asynchronous actions in ordered chains with execution conditions, fallback branches, trace output, and safety limits.

The package is not coupled to a UI, server framework, scheduler, or domain model. An application registers actions and conditions, supplies context and input, and the runner returns the chain execution result.

## Runtime Flow

[View the runtime flow](RUNTIME-FLOW.mmd).

## Public API

```ts
import {
  BUILTIN_ACTIONS,
  BUILTIN_CONDITIONS,
  createMemoryTraceSink,
  defineErrorReporter,
  createPubSub,
  PubSub,
  createFlow,
  createWebSocket,
  catchError,
} from 'slapflow'
```

```ts
const flow = createFlow<Context, Patch>({ config: { strategies: {} } }, { context: () => ({}) as Context })
const runner = flow.runner

runner.registerAction('jobs.execute', executeJob)
runner.registerCondition('hasQueue', ({ context }) => context.queue.length > 0)

runner.loadConfig(config)
const result = await runner.run('worker.tick', context, input)
```

## Core Types

```ts
type Config = {
  version?: 1
  strategies: Record<string, Strategy>
  entrypoints?: Record<string, string>
  guards?: Record<string, ConditionExpression>
}

type ConditionExpression = boolean | [operator: string, ...args: unknown[]] | ['guard', name: string]

type Strategy = {
  fn: string
  props?: Record<string, unknown>
  when?: ConditionExpression
  then?: Next[]
  catch?: Next[]
  mode?: 'sequence' | 'selector' | 'parallel'
  terminal?: boolean
}
```

## Error Reporting

The runner works as a declarative try/catch pipeline: an action can return `runtime.fail(...)` or throw, a strategy can define `catch`, and an application can centrally report errors through `onError`.

```ts
const reportError = defineErrorReporter({
  report: ({ error, context, input, data, patches, events, trace }) => {
    Sentry.captureException(error.cause ?? error, {
      tags: {
        code: error.code,
        phase: error.stage?.phase,
        strategy: error.stage?.strategy,
        fn: error.stage?.fn,
      },
      extra: { context, input, data, patches, events, trace },
    })
  },
})

const flow = createFlow(
  { config: { strategies: {} } },
  { context: () => ({}) as Context, trace: true, onError: reportError }
)
```

`onError` receives `SlapErrorEvent`:

```ts
type SlapErrorEvent<TContext, TPatch> = {
  error: SlapError
  context: TContext
  input: Input
  data: Record<string, unknown>
  patches: TPatch[]
  events: SlapEvent[]
  trace?: TraceEntry[]
}
```

`SlapError.stage` identifies the chain phase:

```ts
type ErrorStage = {
  phase: 'entrypoint' | 'condition' | 'action' | 'catch' | 'limit'
  entrypoint?: string
  strategy?: string
  fn?: string
  mode?: Mode
  step?: number
  depth?: number
}
```

If an error is recovered through `catch`, `onError` is still invoked for the original failure and the final `run` may finish with `success`.

## Action Return Normalization

An action's return value is normalized into one outcome. The mapping:

| Return                                            | Outcome                                                         |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `undefined` / `null`                              | `success`                                                       |
| `false`                                           | `skipped`                                                       |
| `{ type: 'skip', reason?, data? }`                | `skipped` (a selector tries the next branch)                    |
| `{ type: 'stop', reason?, patch?, events? }`      | `stopped` (the chain halts without error)                       |
| `{ type: 'fail', reason?, data?, error? }`        | `failed` (`catch` runs, then `onError`)                         |
| `{ context?, data?, patch?, events?, continue? }` | `success`; `continue: false` halts the remaining `then` targets |

A thrown exception is treated as `fail`. Returning `false` and `{ type: 'skip' }` are equivalent.

## Registry Model

Built-ins live in two shared constants, one per kind:

```ts
import { BUILTIN_ACTIONS, BUILTIN_CONDITIONS } from 'slapflow'
```

`BUILTIN_ACTIONS` is a readonly `[name, action][]` list prepopulated with built-in actions; `BUILTIN_CONDITIONS` holds built-in conditions. Each runner receives its own `new Map(BUILTIN_ACTIONS)` / `new Map(BUILTIN_CONDITIONS)` seed, so registrations stay isolated per runner.

Built-ins are immutable defaults: `registerAction` and `registerCondition` reject an attempt to override a built-in name.

```ts
runner.registerAction('app.setData', customSetData)
runner.registerCondition('hasQueue', hasItems)
```

Configuration validation accesses registries through the minimal `has(name)` contract.

## Built-In Actions

| Action          | Props                                                                                                                                              | Description                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `core.noop`     | —                                                                                                                                                  | Completes successfully without changing runtime state.                                                            |
| `core.stop`     | `reason?`                                                                                                                                          | Stops the run with an optional reason.                                                                            |
| `core.fail`     | `reason?`, `data?`                                                                                                                                 | Fails the current strategy with an optional reason and error data.                                                |
| `core.fetch`    | **`url`**, `method?`, `headers?`, `body?`, `credentials?`, `response?`, `dataPath?`, `contextPath?`, `acceptStatuses?`, `retryStatuses?`, `retry?` | Fetches data with cancellation, response parsing, status control, and retry backoff.                              |
| `core.loop`     | `duration?`, `max?`, `immediate?`                                                                                                                  | Repeats its `then` branch on an interval until aborted or the iteration limit is reached.                         |
| `core.sequence` | —                                                                                                                                                  | Executes `then` targets in order.                                                                                 |
| `core.selector` | —                                                                                                                                                  | Executes `then` targets until one succeeds or stops.                                                              |
| `core.parallel` | —                                                                                                                                                  | Executes `then` targets concurrently in isolated context and data branches.                                       |
| `core.set`      | **`path`**, `value?`, `data?`                                                                                                                      | Writes `value` to a nested context `path`; optional `data` is merged into runtime data.                           |
| `core.setData`  | **`path`**, `value?`, `data?`                                                                                                                      | **Deprecated.** Writes `value` to runtime data; use `runtime.data.set(path, value)` inside an application action. |
| `core.emit`     | **`type`**, `payload?`                                                                                                                             | Appends an event to the run result.                                                                               |
| `core.patch`    | **`patch`**                                                                                                                                        | Appends a patch to the run result.                                                                                |
| `core.delay`    | `ms?`                                                                                                                                              | Waits for the configured duration or until the run is aborted.                                                    |

Bold props are required; `?` marks optional props. All names in this column are fields of the strategy's `props` object.

`core.loop` executes its `then` branch every `props.duration` milliseconds until the run is aborted or `props.max` iterations complete. The default maximum is `999`, leaving one of the default `maxStepCount: 1000` steps for the loop action itself; `max: -1` disables the iteration limit, but not runner safety limits. Zero, values below `-1`, `NaN`, and infinity fall back to the default. When `props.immediate` is `true`, the first iteration executes immediately, counts toward `max`, and does not wait for the first interval. Overlapping iterations are skipped. A failed iteration executes `catch`; the loop continues when `catch` succeeds.
Nested `core.loop` strategies are invalid, including transitive references through `then` or `catch`. Sibling loops in separate branches are allowed.

Actions can execute their own configured branches through `runtime.executeThen()` and `runtime.executeCatch()`. `executeThen()` honors the strategy's `mode`, so control actions such as `core.loop` can compose with `sequence`, `selector`, and `parallel` execution without accessing runner internals.

`core.set` writes a nested context value through `runtime.set`. `core.setData` remains available for compatibility; new application actions should write temporary chain data through `runtime.data.set(path, value)`.

`core.fetch` uses native `fetch` with the run signal. Its `response` prop selects `json`, `text`, `blob`, `arrayBuffer`, or `none`; successful responses are normalized as `{ status, ok, headers, body }` and can be written to `dataPath` or `contextPath`. `acceptStatuses` overrides the default `Response.ok` success condition. `credentials` accepts `include`, `same-origin`, or `omit` and is forwarded to native `fetch`. CORS, preflight requests, SameSite cookie rules, and server cookie policy remain the responsibility of the browser and server. `retry` accepts `initialDelay`, `maxDelay`, `multiplier`, `jitter`, and `maxAttempts`; `retryStatuses` overrides the default retryable statuses. The default performs two retries for network failures and statuses `408`, `425`, `429`, and `5xx`. Response-body parsing failures do not retry. An aborted request or retry returns `skip`. Retries are intended for replayable request bodies.

## Built-In Conditions

| Condition       | Description                                                                   | Example                                                                         |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `and`           | Matches when every nested condition matches.                                  | `['and', ['typeIs', '$input.id', 'string'], ['notEmpty', '$input.id']]`         |
| `or`            | Matches when at least one nested condition matches.                           | `['or', ['eq', '$context.status', 'ready'], ['eq', '$context.status', 'idle']]` |
| `not`           | Inverts a nested condition.                                                   | `['not', ['truthy', '$context.disabled']]`                                      |
| `eq`            | Compares two values with `Object.is`.                                         | `['eq', '$context.status', 'ready']`                                            |
| `neq`           | Matches when `Object.is` does not consider the values equal.                  | `['neq', '$context.status', 'failed']`                                          |
| `gt`            | Compares values numerically with `>`.                                         | `['gt', '$context.count', 0]`                                                   |
| `gte`           | Compares values numerically with `>=`.                                        | `['gte', '$context.count', 1]`                                                  |
| `lt`            | Compares values numerically with `<`.                                         | `['lt', '$context.count', 100]`                                                 |
| `lte`           | Compares values numerically with `<=`.                                        | `['lte', '$context.count', 99]`                                                 |
| `truthy`        | Applies JavaScript truthiness.                                                | `['truthy', '$context.enabled']`                                                |
| `falsy`         | Applies JavaScript falsiness.                                                 | `['falsy', '$context.disabled']`                                                |
| `exists`        | Matches values other than `null` and `undefined`.                             | `['exists', '$data.response']`                                                  |
| `missing`       | Matches `null` or `undefined`.                                                | `['missing', '$data.error']`                                                    |
| `empty`         | Matches empty strings, arrays, maps, sets, objects, and nullish values.       | `['empty', '$context.items']`                                                   |
| `notEmpty`      | Matches supported values with a size greater than zero.                       | `['notEmpty', '$context.items']`                                                |
| `includes`      | Checks membership in strings, arrays, and sets.                               | `['includes', ['parts', 'food'], '$input.resource']`                            |
| `typeIs`        | Matches `string`, `number`, `finite-number`, `boolean`, `array`, or `record`. | `['typeIs', '$input.amount', 'finite-number']`                                  |
| `changed`       | Matches when current and previous values differ by `Object.is`.               | `['changed', '$context.current', '$context.previous']`                          |
| `cooldownReady` | Matches when no previous timestamp exists or the cooldown has elapsed.        | `['cooldownReady', '$context.now', '$context.lastAt', 1000]`                    |

## Config Example

```ts
export const config = {
  version: 1,
  entrypoints: {
    'worker.tick': 'worker.tick',
  },
  strategies: {
    'worker.tick': {
      fn: 'core.selector',
      mode: 'selector',
      then: ['worker.pickQueuedJob', 'worker.idle'],
    },
    'worker.pickQueuedJob': {
      fn: 'jobs.findNext',
      when: ['and', ['eq', '$context.worker.state', 'idle'], ['gt', '$context.worker.queueSize', 0]],
      then: ['jobs.reserve', 'jobs.execute'],
    },
    'worker.idle': {
      fn: 'core.noop',
    },
  },
}
```

## Execution Modes

`sequence` executes `then` targets in order.

`selector` executes `then` targets until the first successful or stopped step. `skip` means “try the next option.”

`parallel` runs `then` targets independently. Plain objects and arrays in runtime context and data are cloned for each branch; infrastructure values such as functions, DOM nodes, and class instances remain references. Safety limits, including `maxStepCount`, remain shared by the whole run. Resulting patches and events are returned to the caller; the runner does not apply them.

### Chain interruption

A non-`success` outcome at a step changes what happens next, depending on the mode:

| Outcome   | `sequence`              | `selector`            |
| --------- | ----------------------- | --------------------- |
| `skipped` | **interrupts the rest** | tries the next branch |

`sequence` is the default mode and interrupts the remaining `then` targets on _any_ non-`success` (`skipped`, `stopped`, `failed`) — not only on failure. A conditional step inside a sequence is therefore a hidden early exit for the whole remainder. When skipping a step must not break the chain, wrap it in a selector with a `core.noop` fallback.

`terminal: true` stops the `then` chain after that strategy even on `success`; `continue: false` in `ActionSuccess` has the same effect.

## Runtime Helpers

```ts
type Runtime = {
  get(path: string): unknown
  set(path: string, value: unknown): void
  data: {
    get(path: string): unknown
    set(path: string, value: unknown): void
  }
  variables?: {
    get(path: string): unknown
  }
  /** @deprecated Use runtime.data.get(path). */
  getData(path: string): unknown
  /** @deprecated Use runtime.data.set(path, value). */
  setData(path: string, value: unknown): void
  resolve(value: unknown): unknown
  signal: AbortSignal
  executeThen(): Promise<RuntimeBranchResult>
  executeCatch(): Promise<RuntimeBranchResult | undefined>
  emit(event: SlapEvent): void
  patch(patch: unknown): void
  stop(reason?: string): ActionStop<unknown>
  fail(reason?: string, data?: Record<string, unknown>): ActionFail
}
```

`runtime.get` and `runtime.set` read and write nested context values. `runtime.data.get` and `runtime.data.set` read and write temporary chain data.

`runtime.getData` and `runtime.setData` are deprecated compatibility aliases and emit a console warning when called.

`runtime.variables.get` reads immutable runtime variables. `runtime.resolve` resolves `$context.*`, `$data.*`, `$input.*`, and immutable `$variables.*` values. It also evaluates `$expression` and `$template` objects recursively, using the expression operators registered in runner options. In `$template`, `{{ path }}` reads runtime data for compatibility; `{{ data.path }}`, `{{ context.path }}`, and `{{ input.path }}` select their source explicitly.

Runtime path get/set is implemented directly through `objwalk`.

## Guards

Reusable `when` expressions live in the `guards` map on `Config` and are referenced from a strategy's `when` (or a `then`/`catch` step's `when`) with the `['guard', name]` node:

```ts
const config = {
  guards: {
    'has-colony': ['truthy', '$data.colonyId'],
    'same-colony': ['eq', '$input.colonyId', '$context.colonyId'],
  },
  strategies: {
    'colony.join': {
      fn: 'colony.join',
      when: ['and', ['guard', 'has-colony'], ['not', ['guard', 'same-colony']]],
    },
  },
}
```

A guard is a plain `ConditionExpression` and may itself reference other guards. References are expanded once when the config is loaded (`loadConfig`), before the runtime evaluates anything, so the runtime never sees a `['guard', ...]` node. Guards are resolved recursively through `and`/`or`/`not`; a reference to an undefined guard is a `GUARD_NOT_FOUND` validation error, and mutually referencing guards produce `GUARD_CYCLE`. A guard value must be a condition expression, not a `$path` string.

Guards exist so a truth criterion can live in one place instead of being duplicated across strategies; they are evaluated data, not registered code (unlike `registerCondition`, which registers an operator function).

## Validation

`validateConfig` validates:

- unknown actions through `actionsRegistry.has(fn)`;
- unknown condition operators through `conditionsRegistry.has(operator)`;
- missing strategies in `then`, `catch`, and `entrypoints`;
- invalid modes;
- invalid path references;
- cycles without a terminal step;
- guard references (`GUARD_NOT_FOUND`, `GUARD_CYCLE`, `GUARD_INVALID`).

## Trace

Trace entries contain:

- step/depth;
- strategy/fn/mode;
- status;
- input;
- props;
- dataBefore/dataAfter;
- durationMs;
- reason.

Trace does not store a complete context snapshot.

## Pub/Sub Bus

`PubSub` is a process-local singleton event bus. Use `createPubSub` for isolated runtimes.

```ts
type AppEvents = {
  'auth.signed-in': { userId: string }
}

const bus = createPubSub<AppEvents>()
const unsubscribe = bus.on('auth.signed-in', ({ parsed, serialized }) => {
  console.log(parsed.userId)
  socket.send(serialized)
})

bus.emit('auth.signed-in', { userId: 'ada' }, { origin: 'api' })
unsubscribe()
```

```ts
type Bus<TEvents extends object = Record<string, unknown>> = {
  on: {
    <TEvent extends keyof TEvents>(event: TEvent, handler: (event: BusEvent<TEvents[TEvent]>) => void): () => void
    (event: EventPattern, handler: (event: BusEvent<unknown>) => void): () => void
  }
  off: {
    <TEvent extends keyof TEvents>(event: TEvent, handler?: (event: BusEvent<TEvents[TEvent]>) => void): void
    (event: EventPattern, handler?: (event: BusEvent<unknown>) => void): void
  }
  emit<TEvent extends keyof TEvents>(
    topic: TEvent,
    payload: TEvents[TEvent],
    options?: { origin?: string }
  ): BusEvent<TEvents[TEvent]>
}

type EventPattern = `${string}*${string}`

type BusEvent<TPayload> = {
  id: string
  topic: string
  occurredAt: number
  origin?: string
  parsed: TPayload
  serialized: string
}
```

`emit` creates an envelope and serializes the payload once before subscribers run. Event identifiers are opaque 12-character alphanumeric runtime IDs for correlation and echo suppression. They are not cryptographically secure and must not be used for access tokens, signatures, public links, or any security-sensitive purpose. `on` returns an unsubscribe function. `off(event, handler)` removes one handler, while `off(event)` clears the channel. An error in one subscriber does not block the others; `createPubSub({ onError })` receives the error and original event. On serialization failure, the bus delivers `{ error }` as `parsed` and the error body as `serialized`, then calls `onError` with the original cause.

### Wildcard subscriptions

A topic may be subscribed by pattern, using `*` to match exactly one dot-delimited segment. A wildcard does not cross a `.` boundary.

```ts
bus.on('hub.user.*', ({ parsed }) => {}) // hub.user.created, hub.user.deleted
bus.on('hub.*.created', ({ parsed }) => {}) // hub.user.created, hub.team.created
bus.on('hub.*.export', ({ parsed }) => {}) // NOT hub.user.audit.export (wildcard spans one segment)
```

Exact-name subscriptions stay O(1); wildcard patterns are matched separately, so registrations without `*` pay no matching cost. A wildcard handler receives `parsed` as `unknown` — narrow it before use. Wildcards work in `bus.on`/`bus.off`.

## Flow

`createFlow` combines configuration, actions, conditions, a context provider, and event bindings. It creates a runner (accessible via `flow.runner`) and supports the `start`/`stop` lifecycle.

```ts
type Events = {
  'form.submit': { email: string }
}

const flow = createFlow<Context, Patch, Events>(
  {
    actions: { 'form.save': saveForm },
    conditions: { allowed: isAllowed },
    events: { '[bus] form.submit': { entrypoint: 'form.submit' } },
    config,
  },
  { bus, context: () => appStore.getState() }
)

const started = flow.start()
flow.stop()
```

A `[bus] <event-name>` binding starts an `entrypoint` from `config.entrypoints`. The event payload must be an object and is passed to the runner as `input`. Context is read for each event, so a context provider returns current state.

```ts
type StartResult = {
  active: string[]
  inactive: Array<{ binding: string; reason: 'unsupported-source' }>
  validation: ValidationResult
}
```

`start()` registers actions and conditions, validates and loads configuration. Bindings are not installed after failed validation. Calling `start()` again replaces existing bindings. `stop()` releases only subscriptions owned by the current chain.

`onRunnerError` in `FlowOptions` is called only when final `RunResult.status === 'failed'`. The callback receives `error`, `result`, `binding`, `entrypoint`, `runId`, and optional `key`. An error recovered by a strategy through `catch` does not invoke `onRunnerError`.

### Concurrency

Each binding supports `parallel`, `latest`, `queue`, and `drop`. The default mode is `parallel`. Concurrency applies to one binding and lane; `key(payload)` creates independent lanes.

```ts
type ConcurrencyOptions<TPayload> = {
  mode?: 'parallel' | 'latest' | 'queue' | 'drop'
  key?: (payload: TPayload) => string
  maxQueueSize?: number
  overflow?: 'drop-oldest' | 'drop-newest'
}
```

Options are set globally in `createFlow` and can be overridden by a binding. `queue` is limited by `maxQueueSize`, which defaults to `50`. On overflow, Slapflow publishes `slapflow.queue.overflow` and `slapflow.run.dropped`.

`ActionArgs` and `Runtime` contain `signal: AbortSignal`. `latest` aborts the previous run in the same lane. `flow.stop({ force: true })` aborts every active run; normal `stop()` removes bindings and does not cancel running actions. Abort is cooperative: an action uses the signal for fetches, timers, and its own asynchronous work.

Lifecycle diagnostics are published through the configured bus:

- `slapflow.run.started`;
- `slapflow.run.finished`;
- `slapflow.run.failed`;
- `slapflow.run.cancelled`;
- `slapflow.run.dropped`;
- `slapflow.queue.overflow`.

### DOM Bindings

A DOM binding key uses the `[dom] <css-selector>:<event>` format. Slapflow installs a delegated listener on `options.root` or `document`. In a runtime without DOM, the binding is added to `inactive` with reason `dom-unavailable`.

```ts
'[dom] .app-button[type="submit"]:click': {
  entrypoint: 'form.submit',
  options: {
    preventDefault: true,
    stopPropagation: false,
    capture: false,
    once: false,
    concurrency: { mode: 'drop' },
    input: ({ event, element, defaultInput }) => defaultInput,
  },
}
```

`defaultInput` has type `{ type, value?, dataset, form? }`. `dataset` contains all `data-*` attributes from the matching element as camelCase keys. `form` is built from the nearest `<form>`; repeated form entries become arrays and `File` remains `File`. For `submit`, `preventDefault` defaults to `true`; for other events, it and `stopPropagation` default to `false`.

### WebSocket Client

`createWebSocket` opens a native `WebSocket` to `url` and proxies every socket event into the bus. No wire format is assumed — each event is dispatched with a fixed topic and an envelope whose `parsed` holds the raw payload.

```ts
const socket = createWebSocket({
  url,
  bus,
  origin: 'client',
})

socket.start()
```

```ts
bus.on('message', ({ parsed }) => {}) // parsed = the raw message (JSON-decoded when possible)
bus.on('open', ({ parsed }) => {}) // { url }
bus.on('close', ({ parsed }) => {}) // { code, reason }
bus.on('error', ({ parsed }) => {}) // { error }
```

Socket events are forwarded with the topic `open`, `message`, `close`, or `error`. `message` payloads are JSON-decoded into `parsed` when valid, otherwise kept as the raw string. Filtering topics is the consumer's responsibility — nothing is allow-listed or rejected inside the client. `reconnect` accepts `initialDelay`, `maxDelay`, `multiplier`, `jitter`, and `maxAttempts`; omitting `maxAttempts` retries indefinitely. `start`, `stop`, `reconnect`, and `status` manage the lifecycle; status is one of `idle`, `connecting`, `connected`, `reconnecting`, or `stopped`.

`createWS` is deprecated and will be removed; migrate to `createWebSocket`.

## Safety Limits

Defaults:

- `maxStepCount`: `1000`
- `maxDepth`: `32`
- `timeout`: `0`
- `trace`: `false`

Limit failures are returned as failed results with `MAX_STEPS`, `MAX_DEPTH`, and `TIMEOUT` codes.

Set `maxStepCount` or `maxDepth` to `-1` to disable that check. Validation emits a `LIMIT_DISABLED` warning because unbounded runs may execute indefinitely and unbounded nesting may exhaust the call stack.
