import {
  type BindingEventMap,
  type Bus,
  type BusBinding,
  type BusBindingKey,
  type ConcurrencyOptions,
  type DomBinding,
  type DomBindingKey,
  type DomForm,
  type DomInput,
  type DrainResult,
  type EventName,
  type EventMap,
  type Input,
  type PoolDefinition,
  type PoolScheduler,
  type PoolStats,
  type PoolTask,
  type StartResult,
  type Flow,
  type FlowDefinition,
  type FlowOptions,
  type ValidationIssue,
} from '~/types'
import { createRunner } from '~/createRunner'
import { PubSub } from '~/createPubSub'
import { PoolError } from '~/helpers/errors/PoolError'
import { isInput } from '~/helpers/chain/isInput'
import { parseDomBinding } from '~/helpers/chain/parseDomBinding'
import { createPoolRegistry } from '~/helpers/pool/createPoolRegistry'
import { isValidPoolKey } from '~/helpers/pool/isValidPoolKey'
import { resolvePoolKey } from '~/helpers/pool/resolvePoolKey'

const busBindingPrefix = '[bus] '
const domBindingPrefix = '[dom] '
const defaultMaxQueueSize = 50

type ActiveRun = {
  controller: AbortController
  id: string
}

type RunLane = {
  active?: ActiveRun | undefined
  queue: Input[]
}

type SchedulableBinding = {
  entrypoint: string
  options?: { concurrency?: ConcurrencyOptions<any> }
}

export const createFlow = <TContext, TPatch = unknown, TEvents extends object = BindingEventMap>(
  definition: FlowDefinition<TContext, TPatch, TEvents>,
  options: FlowOptions<TContext, TPatch, TEvents>
): Flow<TContext, TPatch> => {
  const schedulerRef: { current?: PoolScheduler } = {}
  const runner = createRunner<TContext, TPatch>(options, schedulerRef)
  const bus = options.bus ?? (PubSub as Bus<TEvents>)
  const unsubscribers = new Set<() => void>()
  const lanes = new Map<string, RunLane>()
  const activeRuns = new Set<ActiveRun>()
  const bindingRuns = new Set<ActiveRun>()
  const lastEmitByPool = new Map<string, number>()
  let runCount = 0
  let drainPromise: Promise<DrainResult> | undefined
  let drainResolve: ((result: DrainResult) => void) | undefined

  const emitDiagnostic = (event: string, payload: Record<string, unknown>): void => {
    ;(bus as Bus<EventMap>).emit(event, payload)
  }

  const emitTask = (event: string, task: PoolTask, payload: Record<string, unknown>): void => {
    if (poolAllowsEvents(task.pool, event)) {
      emitDiagnostic(event, { pool: task.pool, entrypoint: task.entrypoint, key: task.key, ...payload })
    }
  }

  const registry = createPoolRegistry({
    pools: options.pools ?? {},
    now: () => Date.now(),
    onQueued: (task, queueDepth) => emitTask('slapflow.task.queued', task, { queueDepth }),
    onOverflow: (task, queueDepth) =>
      emitDiagnostic('slapflow.queue.overflow', {
        pool: task.pool,
        binding: task.binding,
        entrypoint: task.entrypoint,
        key: task.key,
        queueDepth,
      }),
    onDropped: (task, reason) =>
      emitDiagnostic('slapflow.run.dropped', {
        pool: task.pool,
        binding: task.binding,
        entrypoint: task.entrypoint,
        key: task.key,
        reason,
      }),
  })

  schedulerRef.current = { enqueue: (task) => registry.enqueue(task) }

  runner.registerActions(definition.actions ?? {})
  runner.registerConditions(definition.conditions ?? {})

  const poolAllowsEvents = (pool: string, event: string): boolean => {
    const poolDefinition = registry.definition(pool)

    if (!poolDefinition || poolDefinition.events === 'all') {
      return true
    }
    if (poolDefinition.events === 'off') {
      return false
    }
    const now = Date.now()
    const emitKey = `${pool}\u0000${event}`
    const last = lastEmitByPool.get(emitKey) ?? -Infinity

    if (now - last < poolDefinition.eventsMinIntervalMs) {
      return false
    }

    lastEmitByPool.set(emitKey, now)
    return true
  }

  const clearQueuedRuns = (): void => {
    for (const [binding, lane] of lanes) {
      for (const input of lane.queue) {
        emitDiagnostic('slapflow.run.dropped', { binding, input, reason: 'chain-stopped' })
      }
      lane.queue = []
      if (!lane.active) {
        lanes.delete(binding)
      }
    }
  }

  const clearPools = (): void => {
    for (const task of registry.reset()) {
      emitDiagnostic('slapflow.run.dropped', {
        pool: task.pool,
        binding: task.binding,
        entrypoint: task.entrypoint,
        key: task.key,
        reason: 'chain-stopped',
      })
    }
  }

  const remaining = (): number => registry.inFlight() + bindingRuns.size

  const finishDrain = (result: DrainResult): void => {
    if (drainResolve) {
      const resolve = drainResolve

      drainResolve = undefined
      resolve(result)
    }
  }

  const checkDrain = (): void => {
    if (drainResolve && registry.inFlight() === 0 && bindingRuns.size === 0) {
      finishDrain({ drained: true, remaining: 0 })
    }
  }

  const stop = (stopOptions: { force?: boolean } = {}): void => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
    unsubscribers.clear()
    clearQueuedRuns()
    clearPools()
    registry.setDraining(true)
    if (stopOptions.force) {
      for (const run of activeRuns) {
        run.controller.abort()
      }
    }
  }

  const getContext = (): TContext =>
    typeof options.context === 'function' ? (options.context as () => TContext)() : options.context

  const getConcurrency = (target: SchedulableBinding): ConcurrencyOptions =>
    target.options?.concurrency ?? options.concurrency ?? {}

  const dispatchTask = (task: PoolTask, done: (status: string) => void): void => {
    const controller = new AbortController()
    const run: ActiveRun = { controller, id: `run-${++runCount}` }
    const binding = task.binding ?? `[pool] ${task.pool}`
    const payload = { binding, entrypoint: task.entrypoint, key: task.key, pool: task.pool, runId: run.id }
    const startedAt = Date.now()

    activeRuns.add(run)
    if (poolAllowsEvents(task.pool, 'slapflow.run.started')) {
      emitDiagnostic('slapflow.run.started', payload)
    }
    if (poolAllowsEvents(task.pool, 'slapflow.task.started')) {
      emitDiagnostic('slapflow.task.started', {
        pool: task.pool,
        entrypoint: task.entrypoint,
        key: task.key,
        waitMs: Math.max(startedAt - task.enqueuedAt, 0),
      })
    }

    let status = 'failed'

    void runner
      .run(task.entrypoint, getContext(), task.input, {
        signal: controller.signal,
        pool: task.pool,
        ...(task.binding === undefined ? {} : { binding: task.binding }),
      })
      .then((result) => {
        status = result.status
        if (controller.signal.aborted) {
          emitDiagnostic('slapflow.run.cancelled', { ...payload, status: result.status })
        } else if (result.status === 'failed') {
          emitDiagnostic('slapflow.run.failed', { ...payload, error: result.error })
          options.onRunnerError?.({
            error: result.error as NonNullable<typeof result.error>,
            result,
            binding,
            entrypoint: task.entrypoint,
            runId: run.id,
            key: task.key,
          })
        } else if (poolAllowsEvents(task.pool, 'slapflow.run.finished')) {
          emitDiagnostic('slapflow.run.finished', { ...payload, status: result.status })
        }
      })
      .catch((error) => {
        status = 'failed'
        emitDiagnostic(controller.signal.aborted ? 'slapflow.run.cancelled' : 'slapflow.run.failed', {
          ...payload,
          ...(controller.signal.aborted ? {} : { error }),
        })
      })
      .finally(() => {
        activeRuns.delete(run)
        if (poolAllowsEvents(task.pool, 'slapflow.task.finished')) {
          emitDiagnostic('slapflow.task.finished', {
            pool: task.pool,
            entrypoint: task.entrypoint,
            key: task.key,
            durationMs: Math.max(Date.now() - startedAt, 0),
            status,
          })
        }
        done(status)
        checkDrain()
      })
  }

  registry.setDispatch(dispatchTask)

  const startRun = (
    binding: string,
    target: SchedulableBinding,
    input: Input,
    key?: string,
    lane?: RunLane,
    laneKey?: string
  ): void => {
    const controller = new AbortController()
    const run: ActiveRun = { controller, id: `run-${++runCount}` }

    activeRuns.add(run)
    bindingRuns.add(run)
    if (lane) {
      lane.active = run
    }

    emitDiagnostic('slapflow.run.started', { binding, entrypoint: target.entrypoint, key, runId: run.id })

    void runner
      .run(target.entrypoint, getContext(), input, { signal: controller.signal, binding })
      .then((result) => {
        const payload = { binding, entrypoint: target.entrypoint, key, runId: run.id }

        if (controller.signal.aborted) {
          emitDiagnostic('slapflow.run.cancelled', payload)
        } else if (result.status === 'failed') {
          emitDiagnostic('slapflow.run.failed', { ...payload, error: result.error })
          options.onRunnerError?.({
            error: result.error as NonNullable<typeof result.error>,
            result,
            binding,
            entrypoint: target.entrypoint,
            runId: run.id,
            ...(key === undefined ? {} : { key }),
          })
        } else {
          emitDiagnostic('slapflow.run.finished', { ...payload, status: result.status })
        }
      })
      .catch((error) => {
        const payload = { binding, entrypoint: target.entrypoint, key, runId: run.id }

        emitDiagnostic(controller.signal.aborted ? 'slapflow.run.cancelled' : 'slapflow.run.failed', {
          ...payload,
          ...(controller.signal.aborted ? {} : { error }),
        })
      })
      .finally(() => {
        activeRuns.delete(run)
        bindingRuns.delete(run)
        if (lane && lane.active === run) {
          const nextInput = lane.queue.shift()

          lane.active = undefined
          if (nextInput) {
            startRun(binding, target, nextInput, key, lane, laneKey)
          } else {
            lanes.delete(laneKey as string)
          }
        }
        checkDrain()
      })
  }

  const resolveWorkerPool = (binding: string, concurrency: ConcurrencyOptions): PoolDefinition => {
    if (concurrency.pool !== undefined) {
      const named = registry.definition(concurrency.pool)

      if (named) {
        return named
      }
    }
    const name = concurrency.pool ?? binding
    const existing = registry.definition(name)

    if (existing) {
      return existing
    }
    registry.ensurePrivatePool({
      name,
      workers: concurrency.workers ?? 1,
      maxQueueSize: concurrency.maxQueueSize ?? Infinity,
      overflow: concurrency.overflow ?? 'wait',
      events: concurrency.events ?? 'off',
      eventsMinIntervalMs: concurrency.eventsMinIntervalMs ?? 0,
    })
    return registry.definition(name) as PoolDefinition
  }

  const scheduleWorkerRun = (
    binding: string,
    target: SchedulableBinding,
    input: Input,
    concurrency: ConcurrencyOptions
  ): void => {
    const poolDefinition = resolveWorkerPool(binding, concurrency)
    const hasKey = concurrency.key !== undefined && concurrency.key !== null
    let key: string | undefined
    let coalesce: string | undefined

    try {
      key = resolvePoolKey(concurrency.key, input, options.expressions)
      coalesce = resolvePoolKey(concurrency.coalesce ?? undefined, input, options.expressions)
    } catch {
      emitDiagnostic('slapflow.run.dropped', {
        binding,
        entrypoint: target.entrypoint,
        reason: 'key-invalid',
      })
      return
    }
    if (hasKey && key === undefined) {
      emitDiagnostic('slapflow.run.dropped', { binding, entrypoint: target.entrypoint, reason: 'key-invalid' })
      return
    }

    try {
      void registry
        .submit({
          pool: poolDefinition.name,
          entrypoint: target.entrypoint,
          input,
          key: key ?? '',
          binding,
          ...(coalesce === undefined ? {} : { coalesceToken: coalesce }),
        })
        .catch(() => undefined)
    } catch {
      emitDiagnostic('slapflow.run.dropped', { binding, entrypoint: target.entrypoint, reason: 'enqueue-rejected' })
    }
  }

  const scheduleRun = (binding: string, target: SchedulableBinding, input: Input): void => {
    const concurrency = getConcurrency(target)
    const mode = concurrency.mode ?? 'parallel'

    if (mode === 'workers') {
      scheduleWorkerRun(binding, target, input, concurrency)
    } else if (mode === 'parallel') {
      startRun(binding, target, input)
    } else {
      const keyResolver = concurrency.key
      const key = typeof keyResolver === 'function' ? keyResolver(input) : ''
      const laneKey = `${binding}:${key}`
      const lane = lanes.get(laneKey) ?? { queue: [] }

      lanes.set(laneKey, lane)
      if (!lane.active) {
        startRun(binding, target, input, key, lane, laneKey)
      } else if (mode === 'latest') {
        lane.active.controller.abort()
        startRun(binding, target, input, key, lane, laneKey)
      } else if (mode === 'drop') {
        emitDiagnostic('slapflow.run.dropped', { binding, entrypoint: target.entrypoint, key, reason: 'run-active' })
      } else {
        const maxQueueSize = concurrency.maxQueueSize ?? defaultMaxQueueSize
        const queueIsFull = lane.queue.length >= maxQueueSize
        const dropsOldest = concurrency.overflow === 'drop-oldest'

        if (queueIsFull) {
          emitDiagnostic('slapflow.queue.overflow', { binding, entrypoint: target.entrypoint, key, maxQueueSize })
          if (dropsOldest) {
            const dropped = lane.queue.shift()

            emitDiagnostic('slapflow.run.dropped', {
              binding,
              entrypoint: target.entrypoint,
              key,
              reason: 'queue-overflow',
              ...(dropped ? { input: dropped } : {}),
            })
          } else {
            emitDiagnostic('slapflow.run.dropped', {
              binding,
              entrypoint: target.entrypoint,
              key,
              reason: 'queue-overflow',
            })
          }
        }
        if (!queueIsFull || dropsOldest) {
          lane.queue.push(input)
        }
      }
    }
  }

  const subscribeBusBinding = (binding: string, target: BusBinding): void => {
    const event = binding.slice(busBindingPrefix.length) as EventName<TEvents>
    const unsubscribe = bus.on(event, (busEvent) => {
      if (isInput(busEvent.parsed)) {
        scheduleRun(binding, target, busEvent.parsed)
      } else {
        emitDiagnostic('slapflow.run.dropped', {
          binding,
          entrypoint: target.entrypoint,
          reason: 'input-not-object',
        })
      }
    })

    unsubscribers.add(unsubscribe)
  }

  const collectForm = (element: Element): DomForm | undefined => {
    const form =
      typeof HTMLFormElement !== 'undefined' && element instanceof HTMLFormElement ? element : element.closest('form')
    if (!form) {
      return undefined
    }

    const values: DomForm = {}
    for (const [name, value] of new FormData(form)) {
      const current = values[name]

      values[name] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value]
    }
    return values
  }

  const createDomInput = (event: Event, element: Element): DomInput => {
    const value = 'value' in element && typeof element.value === 'string' ? element.value : undefined
    const form = collectForm(element)
    const dataset: Record<string, string> = {}
    if (element instanceof HTMLElement) {
      for (const [key, item] of Object.entries(element.dataset)) {
        if (item !== undefined) {
          dataset[key] = item
        }
      }
    }
    return {
      type: event.type,
      ...(value === undefined ? {} : { value }),
      dataset,
      ...(form ? { form } : {}),
    }
  }

  const subscribeDomBinding = (binding: string, target: DomBinding): boolean => {
    const parsed = parseDomBinding(binding, domBindingPrefix)
    const root = options.root ?? (typeof document === 'undefined' ? undefined : document)
    let active = false

    if (parsed && root) {
      let unsubscribe = (): void => undefined
      const listener = (event: Event): void => {
        const eventTarget = event.target

        if (typeof Element !== 'undefined' && eventTarget instanceof Element) {
          const element = eventTarget.closest(parsed.selector)
          const belongsToRoot =
            !element || typeof Element === 'undefined' || !(root instanceof Element) || root.contains(element)

          if (element && belongsToRoot) {
            const preventDefault = target.options?.preventDefault ?? event.type === 'submit'

            if (preventDefault) {
              event.preventDefault()
            }
            if (target.options?.stopPropagation) {
              event.stopPropagation()
            }

            const defaultInput = createDomInput(event, element)
            const input = target.options?.input?.({ event, element, defaultInput }) ?? defaultInput

            scheduleRun(binding, target, input)
            if (target.options?.once) {
              unsubscribe()
            }
          }
        }
      }

      const listenerOptions = target.options?.capture === undefined ? undefined : { capture: target.options.capture }

      root.addEventListener(parsed.eventType, listener, listenerOptions)
      unsubscribe = () => root.removeEventListener(parsed.eventType, listener, listenerOptions)
      unsubscribers.add(unsubscribe)
      active = true
    }

    return active
  }

  const validatePools = (
    bindings: [string, BusBinding | DomBinding][]
  ): { errors: ValidationIssue[]; warnings: ValidationIssue[] } => {
    const errors: ValidationIssue[] = []
    const warnings: ValidationIssue[] = []
    const declared = options.pools ?? {}
    const poolScopedFields = ['maxQueueSize', 'overflow', 'events', 'eventsMinIntervalMs'] as const

    for (const [name, poolOptions] of Object.entries(declared)) {
      if (!Number.isInteger(poolOptions.workers) || poolOptions.workers <= 0) {
        errors.push({
          code: 'POOL_WORKERS_INVALID',
          message: `Pool "${name}" requires a positive integer "workers"`,
          path: `pools.${name}.workers`,
        })
      }
    }

    for (const [binding, target] of bindings) {
      const concurrency = (target as SchedulableBinding).options?.concurrency

      if (!concurrency) {
        continue
      }
      if (concurrency.pool !== undefined) {
        if (declared[concurrency.pool] === undefined) {
          errors.push({
            code: 'POOL_NOT_FOUND',
            message: `Binding "${binding}" references missing pool "${concurrency.pool}"`,
            path: binding,
          })
        }
        if (concurrency.mode !== 'workers') {
          errors.push({
            code: 'POOL_MODE_INVALID',
            message: `Binding "${binding}" references pool "${concurrency.pool}" but its mode is not "workers"`,
            path: binding,
          })
        }
        const duplicates = poolScopedFields.filter((field) => concurrency[field] !== undefined)

        if (duplicates.length > 0) {
          warnings.push({
            code: 'POOL_FIELDS_IGNORED',
            message: `Binding "${binding}" duplicates ${duplicates.join(', ')}; the pool definition wins`,
            path: binding,
          })
        }
      } else if (concurrency.mode === 'workers') {
        if (!(
          typeof concurrency.workers === 'number' &&
          Number.isInteger(concurrency.workers) &&
          concurrency.workers > 0
        )) {
          errors.push({
            code: 'WORKERS_REQUIRED',
            message: `Binding "${binding}" uses mode "workers" without "pool" and a positive "workers"`,
            path: binding,
          })
        }
      } else {
        if (concurrency.workers !== undefined) {
          warnings.push({
            code: 'WORKERS_IGNORED',
            message: `Binding "${binding}" sets "workers" without mode "workers"; it is ignored`,
            path: binding,
          })
        }
        if (concurrency.key !== undefined && typeof concurrency.key !== 'function') {
          warnings.push({
            code: 'KEY_IGNORED',
            message: `Binding "${binding}" uses a declarative "key" without mode "workers"; only a function is supported by "${concurrency.mode ?? 'parallel'}"`,
            path: binding,
          })
        }
        if (concurrency.coalesce !== undefined && concurrency.coalesce !== null) {
          warnings.push({
            code: 'COALESCE_IGNORED',
            message: `Binding "${binding}" uses "coalesce" without mode "workers"; it is ignored`,
            path: binding,
          })
        }
      }

      if (concurrency.key !== undefined && concurrency.key !== null && !isValidPoolKey(concurrency.key)) {
        errors.push({
          code: 'KEY_INVALID',
          message: `Binding "${binding}" must use "$input.<path>", "$expression", or a function as "key"`,
          path: binding,
        })
      }
      if (
        concurrency.coalesce !== undefined &&
        concurrency.coalesce !== null &&
        !isValidPoolKey(concurrency.coalesce)
      ) {
        errors.push({
          code: 'KEY_INVALID',
          message: `Binding "${binding}" must use "$input.<path>", "$expression", or a function as "coalesce"`,
          path: binding,
        })
      }
    }

    if (options.concurrency?.mode === 'workers' || options.concurrency?.pool !== undefined) {
      errors.push({
        code: 'CONCURRENCY_GLOBAL_POOL',
        message: 'Global concurrency must not define "workers" mode or "pool"; set it per binding',
        path: 'concurrency',
      })
    }
    if (Object.keys(declared).length > 0 && typeof options.context !== 'function') {
      warnings.push({
        code: 'CONTEXT_NOT_FACTORY',
        message: 'Pools are configured but "context" is not a function; concurrent runs share one context object',
        path: 'context',
      })
    }

    return { errors, warnings }
  }

  const start = (): StartResult => {
    stop()
    registry.setDraining(false)
    drainPromise = undefined
    drainResolve = undefined
    lastEmitByPool.clear()

    const validation = runner.loadConfig(definition.config)
    const active: string[] = []
    const inactive: StartResult['inactive'] = []
    const bindings = Object.entries(definition.events ?? {}) as [string, BusBinding | DomBinding][]
    const poolValidation = validatePools(bindings)
    const merged = {
      ok: validation.ok && poolValidation.errors.length === 0,
      errors: [...validation.errors, ...poolValidation.errors],
      warnings: [...validation.warnings, ...poolValidation.warnings],
    }

    if (merged.ok) {
      for (const [binding, target] of bindings) {
        if (binding.startsWith(busBindingPrefix)) {
          subscribeBusBinding(binding as BusBindingKey<TEvents>, target as BusBinding)
          active.push(binding)
        } else if (binding.startsWith(domBindingPrefix)) {
          if (subscribeDomBinding(binding as DomBindingKey, target as DomBinding)) {
            active.push(binding)
          } else {
            inactive.push({ binding, reason: 'dom-unavailable' })
          }
        } else {
          inactive.push({ binding, reason: 'unsupported-source' })
        }
      }
    }

    return { active, inactive, validation: merged }
  }

  const poolStats = (pool?: string): Record<string, PoolStats> | PoolStats => {
    const all = registry.stats()

    if (pool === undefined) {
      return all
    }
    const single = all[pool]

    if (!single) {
      throw new PoolError('POOL_NOT_FOUND', `Pool "${pool}" is not configured`)
    }
    return single
  }

  const drain = (drainOptions: { timeoutMs?: number } = {}): Promise<DrainResult> => {
    if (drainPromise) {
      return drainPromise
    }
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
    unsubscribers.clear()

    drainPromise = new Promise<DrainResult>((resolve) => {
      drainResolve = resolve
      const timeoutMs = drainOptions.timeoutMs

      if (timeoutMs !== undefined) {
        setTimeout(() => {
          if (drainResolve) {
            registry.rejectWaiters('ENQUEUE_DRAINING')
            finishDrain({ drained: false, remaining: remaining() })
          }
        }, timeoutMs)
      }
      checkDrain()
    })

    return drainPromise
  }

  return {
    runner,
    start,
    stop,
    poolStats: poolStats as Flow<TContext, TPatch>['poolStats'],
    drain,
  }
}
