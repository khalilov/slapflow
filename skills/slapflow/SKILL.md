---
name: slapflow
description: Use when writing or editing TypeScript that imports `slapflow`, calls `createFlow`, registers actions/conditions, builds declarative strategy graphs, or works with the PubSub bus and WebSocket client.
---

# slapflow

slapflow is a **declarative orchestration runtime**. You declare *strategies* (what to do, when, and what next) as a graph; the runner executes them. Ordinary TypeScript functions (actions, conditions) are the leaves. The graph owns ordering, branching, loops, and safety limits; application code supplies only the leaves.

## Imports

Named imports only:

```ts
import {
  createFlow,
  createPubSub,
  BUILTIN_ACTIONS,
  BUILTIN_CONDITIONS,
  defineErrorReporter,
  catchError,
  type Config,
  type Strategy,
  type Runtime,
  type ActionArgs,
  type ConditionExpression,
  type SlapError,
} from 'slapflow'
```

## Config shape

```ts
const config: Config = {
  version: 1,
  entrypoints: { 'worker.tick': 'worker.tick' },
  guards: { 'has-colony': ['truthy', '$data.colonyId'] },
  strategies: {
    'worker.tick': { fn: 'core.selector', mode: 'selector', then: ['worker.pick', 'worker.idle'] },
    'worker.pick': { fn: 'jobs.findNext', when: ['guard', 'has-colony'], then: ['jobs.reserve', 'jobs.execute'] },
    'worker.idle': { fn: 'core.noop' },
  },
}
```

- `entrypoints`: map entrypoint name → starting strategy.
- `guards`: reusable `when` expressions, referenced by `['guard', name]`.
- `strategies`: each has `fn` (action name), optional `when`, `then`, `catch`, `mode`, `terminal`, `props`.

## Execution modes

| Mode       | Behaviour on non-`success`                          |
|------------|-----------------------------------------------------|
| `sequence` | **interrupts the rest** of `then` (default)         |
| `selector` | tries next branch (`skipped` = try next)            |
| `parallel` | runs all branches concurrently, isolated data       |

A conditional step in a `sequence` is a **hidden early exit** for the whole remainder. If skipping must not break the chain, wrap it in a selector with `core.noop` fallback.

```ts
// ❌ breaks the chain when condition fails
{ fn: 'jobs.check', when: ['eq', '$context.ready', true], then: ['jobs.run'] }

// ✅ selector with noop fallback — skipping is a normal outcome
{ fn: 'core.selector', mode: 'selector', then: [
  { fn: 'jobs.check', when: ['eq', '$context.ready', true], then: ['jobs.run'] },
  { fn: 'core.noop' }
]}
```

## Built-in actions

| Action          | Required props                | Purpose                                    |
|-----------------|-------------------------------|--------------------------------------------|
| `core.noop`     | —                             | succeeds, does nothing                     |
| `core.stop`     | `reason?`                     | stops the run cleanly                      |
| `core.fail`     | `reason?`, `data?`            | fails strategy, triggers `catch`           |
| `core.fetch`    | `url`, `method?`, `headers?`  | HTTP with retry, parsing, cancellation     |
| `core.loop`     | `duration?`, `max?`, `immediate?` | repeats `then` on interval             |
| `core.sequence` | —                             | explicit sequence (default mode)           |
| `core.selector` | —                             | explicit selector                          |
| `core.parallel` | —                             | explicit parallel                          |
| `core.set`      | `path`, `value?`, `data?`     | writes nested context value                |
| `core.emit`     | `type`, `payload?`            | appends event to result                    |
| `core.patch`    | `patch`                       | appends patch to result                    |
| `core.delay`    | `ms?`                         | waits or aborts                            |

`core.loop`: `max: -1` disables iteration limit (safety limits still apply). Nested `core.loop` (including transitive via `then`/`catch`) is invalid. Default max is `999`. `immediate: true` runs first iteration without delay. Overlapping iterations are skipped; a failed iteration executes `catch`.

`core.fetch` props: **`url`**, `method?`, `headers?`, `body?`, `credentials?` (`include`|`same-origin`|`omit`), `response?` (`json`|`text`|`blob`|`arrayBuffer`|`none`), `dataPath?`, `contextPath?`, `acceptStatuses?`, `retryStatuses?`, `retry?`. Successful response is normalized as `{ status, ok, headers, body }`. Default retry: 2 attempts for network failures and `408`, `425`, `429`, `5xx`. Retry options: `initialDelay`, `maxDelay`, `multiplier`, `jitter`, `maxAttempts`.

## Built-in conditions

`and`, `or`, `not`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `truthy`, `falsy`, `exists`, `missing`, `empty`, `notEmpty`, `includes`, `typeIs`, `changed`, `cooldownReady`.

```ts
['and', ['eq', '$context.status', 'ready'], ['gt', '$context.count', 0]]
['cooldownReady', '$context.now', '$context.lastAt', 1000]
```

Paths: `$context.path`, `$data.path`, `$input.path`, `$variables.path`.

### Dynamic property access

Path strings are resolved literally — `$context.character[$data.characterType]` treats `$data.characterType` as a literal key. For dynamic property access, use `$expression` with the `property` operator:

```ts
// ❌ literal path — picks key "$data.characterType", not its value
['eq', '$context.character[$data.characterType]', 'warrior']

// ✅ $expression — resolves $data.characterType first, then accesses the property
['eq', { $expression: ['property', '$context.character', '$data.characterType'] }, 'warrior']
```

Built-in expression operators: `add`, `subtract`, `multiply`, `divide`, `modulo`, `min`, `max`, `abs`, `round`, `floor`, `ceil`, `clamp`, `at` (array index), `property` (dynamic key), `get` (nested path string), `concat`.

Custom operators can be registered via `expressions` in runner options. `$expression` args are recursively resolved, so nested refs like `$data.key` or another `$expression` work.

## Creating and running a flow

```ts
const flow = createFlow<Context, Patch, Events>(
  {
    config,
    actions: { 'jobs.findNext': findNextAction },
    conditions: { allowed: isAllowed },
    events: { '[bus] job.queued': { entrypoint: 'worker.tick' } },
  },
  { context: () => store.getState(), bus }
)

const { validation } = flow.start()
if (!validation.ok) throw new Error(validation.issues.map(i => `[${i.code}] ${i.message}`).join('\n'))

// Later
const result = await flow.runner.run('worker.tick', context, input)
```

`start()` registers actions/conditions, validates, loads config. Failed validation → bindings not installed. `stop({ force: true })` aborts active runs.

## Concurrency

Each binding supports four modes. Default is `parallel`.

| Mode       | Behaviour |
|------------|-----------|
| `parallel` | every event starts a new run concurrently |
| `latest`   | aborts the previous run in the same lane, starts a new one |
| `queue`    | queues up to `maxQueueSize` (default 50), runs FIFO |
| `drop`     | ignores the event if a run is already active in the lane |

```ts
const flow = createFlow<Context, Patch, Events>(
  { config, actions, conditions, events: { '[bus] job.queued': { entrypoint: 'worker.tick' } } },
  { context: () => store.getState(), bus, concurrency: { mode: 'latest', key: (p) => p.jobId } }
)
```

`key(payload)` creates independent lanes — concurrency applies within one lane. `latest` uses `runtime.signal` (AbortSignal) so actions can cooperatively cancel. On `queue` overflow: bus publishes `slapflow.queue.overflow` and `slapflow.run.dropped`.

`flow.stop({ force: true })` aborts **every** active run. Normal `stop()` removes bindings but does not cancel running actions.

## `$variables` and `$template`

**`$variables`** are immutable values available in path resolution. They are read-only — `runtime.variables.get(path)`.

```ts
// in condition args or $expression
['eq', '$variables.API_VERSION', '2']
{ $expression: ['at', '$variables.CONTRACTS', '$input.index'] }
```

**`$template`** builds a string from interpolated parts with optional fallbacks:

```ts
{ $template: 'Hello, {{ context.user.name }}! You have {{ data.count || 0 }} messages.' }
```

- `{{ path }}` reads runtime data (compatibility shorthand).
- `{{ data.path }}`, `{{ context.path }}`, `{{ input.path }}` select source explicitly.
- `{{ var || fallback }}` provides a default when the variable is missing.
- `$template` args are resolved recursively, so `$expression` objects work inside.

## Lifecycle events

Published through the configured bus:

| Topic | Payload |
|-------|---------|
| `slapflow.run.started` | run metadata |
| `slapflow.run.finished` | run result |
| `slapflow.run.failed` | error + result |
| `slapflow.run.cancelled` | aborted run |
| `slapflow.run.dropped` | dropped by `latest`/`drop` |
| `slapflow.queue.overflow` | queue full |

```ts
bus.on('slapflow.run.failed', ({ parsed }) => {
  console.error('Run failed:', parsed.error.code)
})
```

## Actions and conditions

```ts
// Action — plain async function receiving ActionArgs
const findNextAction = async ({ context, input, data, runtime }: ActionArgs<Context>) => {
  const job = await db.jobs.findNext(context.worker.id)
  if (!job) return { type: 'skip', reason: 'no-job' }
  return { data: { jobId: job.id }, context: { worker: { ...context.worker, currentJob: job.id } } }
}

// Condition — sync function returning boolean
const isAllowed = ({ context }: ActionArgs<Context>) => context.user.role === 'admin'
```

Register via `createFlow` options or `runner.registerAction`/`registerCondition`. Built-ins cannot be overridden.

### Action return normalization

| Return                              | Outcome               |
|-------------------------------------|-----------------------|
| `undefined` / `null`                | `success`             |
| `false`                             | `skipped`             |
| `{ type: 'skip', reason?, data? }`  | `skipped` (selector tries next) |
| `{ type: 'stop', reason?, patch?, events? }` | `stopped`    |
| `{ type: 'fail', reason?, data?, error? }` | `failed` (catch runs) |
| `{ context?, data?, patch?, events?, continue? }` | `success`; `continue: false` halts chain |

## `when` vs action vs `runtime.fail`

Three layers, each with a distinct job:

| Layer | Where | What it checks | Result on mismatch |
|-------|-------|----------------|-------------------|
| **`when`** | strategy | immediately available fields — presence, type, routing discriminator | `skipped` (selector tries next) |
| **action** | leaf function | search, computation, domain state that needs reading/mutating | `skip` for "no match" normal outcome |
| **`runtime.fail`** | inside action | execution invariant — something that *should never happen* given the `when` that admitted this path | `failed` (triggers `catch`, then `onError`) |

**`skip` ≠ `fail`.** Domain "didn't work" (a faster actor took the job, a path was blocked, no matching record) is almost always a normal outcome — return `{ type: 'skip' }`. `fail` is reserved for broken invariants: the action was admitted by `when`, the data looked valid, but something went wrong mid-execution. Routing normal outcomes through `fail` turns every such case into an error event.

Declare an entry criterion **once** — on a named strategy, not on every `then`/`catch` edge. Avoid inline `{ strategy, when }`. Set branch-specific context on a named strategy of that branch, not on a shared parent.

## Runtime helpers (inside actions)

```ts
runtime.get(path)              // read nested context
runtime.set(path, value)       // write nested context
runtime.data.get(path)         // read chain-local data
runtime.data.set(path, value)  // write chain-local data
runtime.variables.get(path)    // read immutable variables
runtime.resolve(value)         // resolve $context.*, $data.*, $input.*, $variables.*, $expression, {{template}}
runtime.signal                 // AbortSignal for cancellation
runtime.emit(event)            // append event
runtime.patch(patch)           // append patch
runtime.stop(reason?)          // return ActionStop
runtime.fail(reason?, data?)   // return ActionFail
runtime.executeThen()          // run this strategy's `then` branch
runtime.executeCatch()         // run this strategy's `catch` branch
```

## Guards

```ts
guards: {
  'has-colony': ['truthy', '$data.colonyId'],
  'same-colony': ['eq', '$input.colonyId', '$context.colonyId'],
},
strategies: {
  'colony.join': {
    fn: 'colony.join',
    when: ['and', ['guard', 'has-colony'], ['not', ['guard', 'same-colony']]],
  },
}
```

Guards expand once at `loadConfig`. Undefined → `GUARD_NOT_FOUND`, cycles → `GUARD_CYCLE`.

## PubSub bus

```ts
const bus = createPubSub<Events>()
bus.on('auth.signed-in', ({ parsed }) => console.log(parsed.userId))
bus.emit('auth.signed-in', { userId: 'ada' })
```

Wildcard: `hub.user.*` matches one segment (`hub.user.created`), not `hub.user.audit.export`. Wildcard handlers receive `parsed: unknown`.

## WebSocket client

```ts
const ws = createWebSocket({ url, bus, origin: 'client' })
ws.start()
// bus receives: 'open' | 'message' | 'close' | 'error'
```

## Error reporting

`onError` fires for every failed run — even when `catch` recovers, the original error is still reported:

```ts
const reportError = defineErrorReporter({
  report: ({ error, context, input, data, patches, events, trace }) => {
    Sentry.captureException(error.cause ?? error, {
      tags: { code: error.code, phase: error.stage?.phase, strategy: error.stage?.strategy, fn: error.stage?.fn },
      extra: { context, input, data, patches, events, trace },
    })
  },
})

const flow = createFlow({ config, actions, conditions }, { context, bus, onError: reportError })
```

`onRunnerError` in `FlowOptions` fires **only** when the final `RunResult.status === 'failed'` (i.e. `catch` did not recover). It receives `error`, `result`, `binding`, `entrypoint`, `runId`, and optional `key`.

**Use `onError`** for observability (log every failure). **Use `onRunnerError`** for alerting (unrecovered failures only).

## Safety limits

Defaults: `maxStepCount: 1000`, `maxDepth: 32`, `timeout: 0`, `trace: false`. Set `-1` to disable a limit (emits `LIMIT_DISABLED` warning).

## Trace

Enable with `trace: true` in flow options. Each entry records: step/depth, strategy/fn/mode, status, input, props, dataBefore/dataAfter, durationMs, reason. Does not store a full context snapshot.

```ts
const flow = createFlow({ config, actions, conditions }, { context, bus, trace: true })
// result.trace contains TraceEntry[]
```

## Key rules

- **`when`/`action`/`fail` have distinct roles** — see "`when` vs action vs `runtime.fail`" above.
- **Branching = selector, not `catch`.** `catch` fires only on `fail`/throw. Domain "didn't work" is normal → use selector.
- **`terminal: true`** stops the chain after that strategy even on `success`.
- **Context is mutable and shared** — mutate synchronously; no `await` between reading and writing the same field.

Full reference: `SPEC.md` (this repo).