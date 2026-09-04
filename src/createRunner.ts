import {
  type Action,
  type ConditionFn,
  type Config,
  type Input,
  type RunResult,
  type Runner,
  type RunOptions,
  type RunnerOptions,
  type ValidationResult,
} from '~/types'
import { SyncAsyncError } from '~/helpers/errors/syncAsyncError'
import { BUILTIN_ACTION_NAMES, BUILTIN_ACTIONS, type ActionsRegistry } from '~/helpers/actions'
import { BUILTIN_CONDITION_NAMES, BUILTIN_CONDITIONS, type ConditionsRegistry } from '~/helpers/conditions'
import { createMemoryTraceSink } from '~/helpers/trace/createMemoryTraceSink'
import { executeStrategy } from '~/helpers/runner/executeStrategy'
import { finishRunResult } from '~/helpers/runner/finishRunResult'
import { slapError } from '~/helpers/errors/slapError'
import { isPromiseLike } from '~/helpers/runner/isPromiseLike'
import { resolveEntrypoint } from '~/helpers/runner/resolveEntrypoint'
import { runnerLimitWarnings } from '~/helpers/validation/runnerLimitWarnings'
import { type Normalized, type RunnerEnvironment, type RunState } from '~/helpers/runner/runnerTypes'
import { validateConfig as validateRawConfig } from '~/helpers/validation/validateConfig'
import { resolveGuards } from '~/helpers/validation/resolveGuards'
import { cloneRuntimeVariables } from '~/helpers/runner/cloneRuntimeVariables'
import { createRunCancellation } from '~/helpers/runner/createRunCancellation'

export const createRunner = <TContext, TPatch = unknown>(
  options: RunnerOptions<TContext, TPatch> = {}
): Runner<TContext, TPatch> => {
  const actionsRegistry = new Map(BUILTIN_ACTIONS) as ActionsRegistry<TContext, TPatch>
  const conditionsRegistry = new Map(BUILTIN_CONDITIONS) as ConditionsRegistry<TContext>
  const configRef: { current?: Config } = {}
  const timeout = options.timeout ?? options.timeoutMs
  const runnerOptions = timeout === undefined ? options : { ...options, timeout }
  const mergeData = options.mergeData ?? ((current, next) => ({ ...current, ...next }))
  const variables = cloneRuntimeVariables(options.variables ?? {})

  if (options.timeoutMs !== undefined) {
    console.warn('timeoutMs is deprecated; use timeout. It will be removed in a future major release.')
  }

  const environment: RunnerEnvironment<TContext, TPatch> = {
    registry: { actions: actionsRegistry, conditions: conditionsRegistry },
    configRef,
    options: runnerOptions,
    mergeData,
  }

  const registerAction = (name: string, action: Action<TContext, TPatch>): void => {
    if (BUILTIN_ACTION_NAMES.has(name)) {
      throw new Error(`Cannot override built-in action "${name}"`)
    }
    actionsRegistry.set(name, action)
  }

  const registerActions = (items: Record<string, Action<TContext, TPatch>>): void => {
    Object.entries(items).forEach(([name, action]) => registerAction(name, action))
  }

  const registerCondition = (name: string, condition: ConditionFn<TContext>): void => {
    if (BUILTIN_CONDITION_NAMES.has(name)) {
      throw new Error(`Cannot override built-in condition "${name}"`)
    }
    conditionsRegistry.set(name, condition)
  }

  const registerConditions = (items: Record<string, ConditionFn<TContext>>): void => {
    Object.entries(items).forEach(([name, condition]) => registerCondition(name, condition))
  }

  const validateConfig = (target = configRef.current): ValidationResult => {
    const result = validateRawConfig(target, actionsRegistry, conditionsRegistry)
    return { ...result, warnings: [...result.warnings, ...runnerLimitWarnings(runnerOptions)] }
  }

  const loadConfig = (nextConfig: Config): ValidationResult => {
    configRef.current = resolveGuards(nextConfig).config
    return validateConfig(nextConfig)
  }

  const runInternal = (
    entrypoint: string,
    context: TContext,
    input: Input,
    sync: boolean,
    runOptions: RunOptions
  ): RunResult<TContext, TPatch> | Promise<RunResult<TContext, TPatch>> => {
    const traceSink = options.trace === true ? createMemoryTraceSink() : options.trace || undefined
    const cancellation = createRunCancellation(runOptions.signal)
    const state: RunState<TContext, TPatch> = {
      context,
      input,
      data: {},
      patches: [],
      events: [],
      stepCounter: { current: 0 },
      startedAt: Date.now(),
      sync,
      signal: cancellation.controller.signal,
      abort: () => cancellation.controller.abort(),
      closed: false,
      reportedErrors: [],
      variables,
      expressions: options.expressions ?? {},
      ...(traceSink ? { traceSink } : {}),
    }

    const reportError = (result: Normalized<TContext, TPatch>): void => {
      if (result.status !== 'failed' || state.reportedErrors.includes(result.error)) {
        return
      }
      state.reportedErrors.push(result.error)
      options.onError?.({
        error: result.error,
        context: state.context,
        input: state.input,
        data: state.data,
        patches: state.patches,
        events: state.events,
        ...(traceSink?.entries ? { trace: traceSink.entries() } : {}),
      })
    }
    const finish = (result: Normalized<TContext, TPatch>): RunResult<TContext, TPatch> => {
      state.closed = true
      cancellation.dispose()

      return finishRunResult(result, state, traceSink || undefined)
    }
    const start = resolveEntrypoint(entrypoint, environment)

    if ('error' in start) {
      const result: Normalized<TContext, TPatch> = { status: 'failed', error: start.error, patches: [], events: [] }
      reportError(result)
      return finish(result)
    }

    const executed = executeStrategy(start.id, {}, 0, state, environment)
    const done = (result: Normalized<TContext, TPatch>) => {
      reportError(result)
      return finish(result)
    }

    return isPromiseLike(executed) ? executed.then(done) : done(executed)
  }

  const run = async (
    entrypoint: string,
    context: TContext,
    input: Input = {},
    runOptions: RunOptions = {}
  ): Promise<RunResult<TContext, TPatch>> =>
    runInternal(entrypoint, context, input, false, runOptions) as Promise<RunResult<TContext, TPatch>>

  const runSync = (
    entrypoint: string,
    context: TContext,
    input: Input = {},
    runOptions: RunOptions = {}
  ): RunResult<TContext, TPatch> => {
    const result = runInternal(entrypoint, context, input, true, runOptions)
    if (isPromiseLike(result)) {
      throw new SyncAsyncError(slapError('ASYNC_IN_SYNC_RUN', 'runSync encountered an async action'))
    }
    return result
  }

  return {
    registerAction,
    registerActions,
    registerCondition,
    registerConditions,
    loadConfig,
    validateConfig,
    run,
    runSync,
  }
}
