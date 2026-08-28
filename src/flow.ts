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
  type EventName,
  type EventMap,
  type Input,
  type StartResult,
  type Flow,
  type FlowDefinition,
  type FlowOptions,
} from '~/types'
import { createRunner } from '~/runner'
import { PubSub } from '~/pubSub'
import { isInput } from '~/helpers/chain/isInput'
import { parseDomBinding } from '~/helpers/chain/parseDomBinding'
import { on } from 'node:cluster'
import { clear, error } from 'node:console'
import { get } from 'node:http'
import { abort } from 'node:process'
import { push } from 'node:stream/iter'
import { aborted } from 'node:util'
import { set } from 'objwalk'

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
  const runner = createRunner<TContext, TPatch>(options)
  const bus = options.bus ?? (PubSub as Bus<TEvents>)
  const unsubscribers = new Set<() => void>()
  const lanes = new Map<string, RunLane>()
  const activeRuns = new Set<ActiveRun>()
  let runCount = 0

  runner.registerActions(definition.actions ?? {})
  runner.registerConditions(definition.conditions ?? {})

  const emitDiagnostic = (event: string, payload: Record<string, unknown>): void => {
    ;(bus as Bus<EventMap>).emit(event, payload)
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

  const stop = (stopOptions: { force?: boolean } = {}): void => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
    unsubscribers.clear()
    clearQueuedRuns()
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
    if (lane) {
      lane.active = run
    }

    emitDiagnostic('slapflow.run.started', { binding, entrypoint: target.entrypoint, key, runId: run.id })

    void runner
      .run(target.entrypoint, getContext(), input, { signal: controller.signal })
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
        if (lane && lane.active === run) {
          const nextInput = lane.queue.shift()

          lane.active = undefined
          if (nextInput) {
            startRun(binding, target, nextInput, key, lane, laneKey)
          } else {
            lanes.delete(laneKey as string)
          }
        }
      })
  }

  const scheduleRun = (binding: string, target: SchedulableBinding, input: Input): void => {
    const concurrency = getConcurrency(target)
    const mode = concurrency.mode ?? 'parallel'

    if (mode === 'parallel') {
      startRun(binding, target, input)
    } else {
      const key = concurrency.key?.(input) ?? ''
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

  const start = (): StartResult => {
    stop()

    const validation = runner.loadConfig(definition.config)
    const active: string[] = []
    const inactive: StartResult['inactive'] = []

    if (validation.ok) {
      const bindings = Object.entries(definition.events ?? {}) as [string, BusBinding | DomBinding][]

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

    return { active, inactive, validation }
  }

  return { runner, start, stop }
}
