# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0]

### Added

- `contains` built-in condition: `['contains', '$input', ['colonyId', 'requestId']]` checks that every listed own field has a value other than `null` or `undefined`. `false`, `0`, and empty strings count as present. Nested objects can be passed as the first operand.
- Optional `Config.types` rules keyed by exact field name for `when` and named guards. Referenced `context/input` fields are checked at any nesting depth; `contains` checks its listed fields against the same rules. Supported variants are `string`, `number`, `boolean`, `undefined`, and JSON `null`, with non-empty flat arrays for unions. Exported `TypeVariant`, `TypeDeclaration`, and `TypeRules` types.
- Optional `EvaluationScope.types` for standalone evaluators, including nested expressions, templates, and condition runtime reads. Checks apply only to fields read by conditions; short-circuited operands and unrelated state are not checked. Invalid declarations produce `CONFIG_TYPES_INVALID`; type mismatches use existing condition error handling with `TYPE_MISMATCH`.

### Documented

- `contains` and field type rules in English and Russian documentation and the agent skill. Corrected skill examples and clarified `terminal`/`continue` behavior in the skill and Russian specification.
- Flow screenshot in both READMEs; the package now includes `README-RU.md` and `flow.png`.

## [2.0.0]

### Added

- Standalone `evaluateCondition` and `evaluateExpression` helpers with explicit scope, built-in and custom handlers, and structured success/error results. Exported `EvaluationScope`, `ConditionEvaluationOptions`, `ExpressionEvaluationOptions`, `ConditionOutcome`, and `ExpressionOutcome` types.

### Fixed

- Condition validation rejects `not` expressions without exactly one operand.

### Removed

- Deprecated `runtime.getData`; use `runtime.data.get` instead.
- Deprecated `createWS` adapter and its `WS`, `WSOptions`, `WSRetryOptions`, `WSSocket`, and `WSStatus` types. Use `createWebSocket` instead.

## [1.5.1] - 27.09.2026

### Added

- `core.invoke` built-in action: runs its `then` branch once per element of `props.items` — an array's values, or an object's values in insertion order — with `$input` set to the element. A non-iterable `items` fails the strategy so `catch` handles it; an empty collection runs nothing. Iterations are sequential and a failed iteration does not stop the loop.
- `runtime.executeThen({ input })` runs a strategy's `then` branch with a temporary run input.

### Changed

- `Runtime.executeThen` accepts an optional `{ input }` argument.

## [1.3.0] - 17.09.2026

### Added

- `workers` concurrency mode: a keyed worker pool with a global `workers` cap, strict FIFO per line key, and work-conserving selection across keys.
- Named pools via `FlowOptions.pools`, shared by bindings that reference `concurrency.pool`. A `workers` binding without a pool gets a private one.
- `runtime.enqueue(entrypoint, input, { pool, key?, coalesceToken? })` for fan-out from actions. `overflow: 'wait'` applies backpressure instead of dropping; `coalesceToken` replaces a not-yet-started task in the same line. Resolves on acceptance, not completion.
- `Flow.poolStats()` (`active`/`queued`/`oldestQueuedMs` per pool and per key) and `Flow.drain({ timeoutMs })` for graceful shutdown.
- Lifecycle events `slapflow.task.queued`, `slapflow.task.started`, and `slapflow.task.finished`.
- Exported `EnqueueError` (with `ENQUEUE_UNKNOWN_POOL`, `ENQUEUE_SELF_POOL`, `ENQUEUE_KEY_INVALID`, `ENQUEUE_DRAINING`) and `PoolError`.
- `ensure` control condition operator: a non-matching `when` (or guard root) runs the strategy's `catch` without invoking `onError`. Valid only as the root of a strategy `when` or guard (`ENSURE_PLACEMENT_INVALID`), and requires a `catch` branch (`ENSURE_WITHOUT_CATCH`).
- `coalesce` built-in `$expression` operator: returns the first non-nullish argument.

### Changed

- `ConcurrencyMode` adds `'workers'`; `QueueOverflow` adds `'wait'`.
- `ConcurrencyOptions.key` and `coalesce` accept a function, a `$input.<path>` string, or `{ $expression }`. Bare strings and non-`$input` roots are rejected at `start()`; a binding whose key resolves to a non-string drops the event (`key-invalid`), while `runtime.enqueue` reports `ENQUEUE_KEY_INVALID`.
- `ConcurrencyOptions` adds `events`/`eventsMinIntervalMs` for private pools. Pooled runs gate `task.*` and `run.started`/`run.finished` by `events` (`'off'` by default, sampled per event topic); `run.failed`/`run.cancelled` and `queue.overflow` are always published.
- `slapflow.run.*` payloads carry `pool`; `slapflow.queue.overflow` carries `pool`/`queueDepth`.
- `createFlow` validates pool bindings at `start()`: errors `POOL_NOT_FOUND`, `POOL_MODE_INVALID`, `POOL_WORKERS_INVALID`, `WORKERS_REQUIRED`, `KEY_INVALID`, `CONCURRENCY_GLOBAL_POOL`, and warnings `WORKERS_IGNORED`, `KEY_IGNORED`, `COALESCE_IGNORED`, `POOL_FIELDS_IGNORED`, `CONTEXT_NOT_FACTORY`.
- `Runtime.enqueue` is optional and only present when pools/`workers` are configured.

### Documented

- Worker pools, backpressure, fan-out, pool stats, and drain in `README`/`SPEC` and the agent skill.
- `ensure` routing and the `coalesce` operator in `SPEC` and the agent skill.

## [1.2.0] - 2026-09-04

### Added

- `createWebSocket`: a native WebSocket client that proxies socket events (`open`, `message`, `close`, `error`) into the bus and manages reconnection. No wire format is assumed — raw payloads land in `parsed`.

### Changed

- Built-ins are immutable: `registerAction`/`registerCondition` reject overriding a built-in name. Built-in lists now live in `BUILTIN_ACTIONS`/`BUILTIN_CONDITIONS` instead of the removed `createActionsRegistry`/`createConditionsRegistry` factories.

### Deprecated

- `createWS` is deprecated and will be removed; migrate to `createWebSocket`.

## [1.1.0] - 2026-09-04

### Added

- Reusable `when` expressions via the `guards` map on `Config`, referenced with the `['guard', name]` node. Guards are expanded once at `loadConfig`; `GUARD_NOT_FOUND`, `GUARD_CYCLE`, and `GUARD_INVALID` are reported during validation.
- Wildcard pub/sub subscriptions: `*` matches exactly one dot-delimited segment. Wildcards work in `bus.on`/`bus.off`.
- Agent guide (`AGENTS.md`) describing how to edit a graph.

### Changed

- `Bus.on`/`Bus.off` now accept a wildcard `EventPattern`; pattern handlers receive `parsed` as `unknown`.

### Documented

- Action return normalization, chain interruption semantics, and project positioning ("when to use Slapflow").

## [1.0.2] - 2026-08-29

- Link slapflow-studio as an example app.

## [1.0.1] - 2026-08-29

## [1.0.0] - 2026-08-29

- Initial release: `slapflow` — a runtime for declaring orchestration as a graph. The project was migrated from [`chain-functions-behavior`](https://www.npmjs.com/package/chain-functions-behavior) and rebranded with a new public API.
