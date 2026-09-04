# Slapflow — guide for agents

Slapflow is a runtime for declaring orchestration as a graph: declarative strategies with conditions and branches (`then`/`catch`) plus ordinary TypeScript functions (actions, conditions) as leaves. Ordering and control flow live in the graph; application code supplies only leaf actions and adapters.

Authoritative semantics live in this repo's `SPEC.md` (and `SPEC-RU.md`), not in `src/**/dist` and not in intuition. When anything is ambiguous, read SPEC/README before touching the graph or the runtime.

## Three rules that make graphs read correctly

1. **A non-matching `when` yields `skipped`, and `sequence` breaks on any non-`success`.** A conditional step inside a sequence is a hidden early exit for the whole remainder. If skipping a step must not break the chain, wrap it in a selector with a `core.noop` fallback.

   | Mode       | `skipped`            | anything else      |
   | ---------- | -------------------- | ------------------ |
   | `selector` | try the next branch  | return result      |
   | `sequence` | **break the rest**   | break the rest     |

   Default mode is `sequence`. A selector is declared explicitly: `"fn": "core.selector", "mode": "selector"`.

2. **Branching is a selector, not `catch`.** `catch` fires only on `fail` or a thrown exception; `onError` is invoked even when `catch` recovered. Domain "didn't work" is almost always a normal outcome (a faster actor took the job, a path was blocked) — routing it through `catch` would turn every such case into an error event. Keep `fail` for broken invariants and `catch` for the one place where a single entity's failure must not sink the whole run.

3. **A loop is a tick, not a graph.** A decision selector never calls itself: repetition comes from the next run passing through the chain from the top. Self-reference hits `maxDepth: 32` and returns `MAX_DEPTH`. `then` holds the steps of the action itself, not a re-decision. Cadence is declared with `core.loop`.

## Shape of a flow

```ts
import { createFlow } from 'slapflow'

const config = {
  version: 1,
  entrypoints: { 'worker.tick': 'worker.tick' },
  strategies: {
    'worker.tick': { fn: 'core.selector', mode: 'selector', then: ['worker.pick', 'worker.idle'] },
    'worker.pick': {
      fn: 'jobs.findNext',
      when: ['and', ['eq', '$context.worker.state', 'idle'], ['gt', '$context.worker.queueSize', 0]],
      then: ['jobs.reserve', 'jobs.execute'],
    },
    'worker.idle': { fn: 'core.noop' },
  },
}

const flow = createFlow<Context, Patch, Events>(
  { config, actions: { 'jobs.findNext': findNext }, conditions: { allowed: isAllowed } },
  { context: () => store.getState(), bus }
)
const { validation } = flow.start()
```

- `entrypoints` maps an entrypoint name to its starting strategy; `runner.run(entrypoint, context, input)` starts there.
- Context is one mutable object per process, shared by a long-lived `core.loop` and external runs. Mutate it synchronously — no `await` between reading and writing the same field, or two concurrent runs will interleave.
- `start()` registers actions/conditions, validates, and loads config; on validation failure bindings are not installed. Calling `start()` again replaces bindings. `stop({ force: true })` also aborts active runs.

## `when` vs action

- `when` checks only immediately available fields of `input`, `data`, `context` — presence, type, routing discriminator. Search, computation, and domain-state checks stay in the action.
- Declare an entry criterion in one place — on a named strategy, not on every edge. Avoid inline `{ strategy, when }`.
- Set branch-specific context on a named strategy of that branch, not on a shared parent.
- Use `runtime.fail` inside an action for an execution invariant that needs searching/computing/mutating domain state.

## Guards

A repeated `when` expression becomes a named guard in `config.guards`, referenced by `['guard', name]`:

```jsonc
{
  "guards": {
    "has-colony": ["truthy", "$data.colonyId"],
    "same-colony": ["eq", "$input.colonyId", "$context.colonyId"]
  },
  "strategies": {
    "colony.join": { "fn": "colony.join", "when": ["and", ["guard", "has-colony"], ["not", ["guard", "same-colony"]]] }
  }
}
```

Guards are data (`ConditionExpression`), not registered code — `registerCondition` registers an operator function, guards name reusable truth expressions. A guard may reference other guards; refs expand once in `loadConfig`, and the runtime never sees `['guard', ...]`. Undefined guard → `GUARD_NOT_FOUND`, mutual refs → `GUARD_CYCLE`.

## Branching

- A normal optional branch inside a sequence → selector with `core.noop` fallback. The selector makes skipping a normal outcome and does not break the rest of the sequence.
- A closed-set selector → end it with an unconditional `core.fail` with a `reason`: no match violates the contract.
- A selector entrypoint may return `skipped` when "no match" is a normal result of the whole entrypoint.

## `terminal` and leaves

`terminal: true` stops the `then` chain after that strategy even on `success` (otherwise sequence would continue). Put it on leaf actions. `continue: false` in `ActionSuccess` has the same effect.

## Cadence and loop

Domain time is `core.loop`:

```json
{
  "fn": "core.loop",
  "props": { "duration": 1000, "immediate": true, "max": -1 },
  "then": ["tick.emit"]
}
```

Nested `core.loop` is forbidden (including transitively through `then`/`catch`); siblings in separate branches are allowed. `max: -1` disables the iteration limit, but not safety limits.

## How to edit a graph

1. Read the semantics in SPEC/README first.
2. Design the chain: entrypoint → strategies, each step an action or a built-in (`core.selector`/`core.sequence`/`core.loop`/…). Branching = selector, not `catch`.
3. Declare strategies in config: `fn`, `when`, `then`, `mode`, `terminal`. An `fn` name must match a registered action key or be a built-in.
4. Register leaves: each new `fn` → `runner.registerAction`/`registerCondition` (or the `actions`/`conditions` object in `createFlow`).
5. Wire through `createFlow` (config + actions + conditions + event bindings) and `start()`.
6. Check: `start()` returns `validation` — on `!validation.ok` list every `[code] message`. Then run: config errors surface on start; semantic errors surface on a run.

## Gotcha: custom conditions and built-ins

A service may register a custom condition whose name duplicates or masks a built-in (`runner.registerCondition` overwrites the entry). An operator name in `when` resolves against the registered set — make sure it exists in this runner's condition registry.

## Wildcard subscriptions

The pub/sub bus supports pattern subscriptions: `*` matches exactly one dot-delimited segment and does not cross a `.`. Pattern handlers receive `parsed` as `unknown`. Wildcards work in `bus.on`/`bus.off` and in `createWS` `inboundTopics`/`outboundTopics`. See SPEC "Wildcard subscriptions" for exact semantics.

## Full API reference

Built-in actions, conditions, runtime helpers, modes, `core.loop`/`core.fetch` props, lifecycle events, and safety limits are in `SPEC.md`. There is no separate reference file in this repo — SPEC is the single source.
