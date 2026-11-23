import { each } from 'objwalk'
import { snapshotConfig } from '~/helpers/config/snapshotConfig'
import {
  type Action,
  type ConditionFn,
  type Config,
  type Input,
  type PoolScheduler,
  type RunResult,
  type Runner,
  type RunOptions,
  type RunnerOptions,
  type ValidationResult,
} from '~/types'
import { SyncAsyncError } from '~/helpers/errors/syncAsyncError'
import { BUILTIN_ACTIONS } from '~/helpers/actions'
import { BUILTIN_CONDITIONS } from '~/helpers/conditions'
import { createMemoryTraceSink } from '~/helpers/trace/createMemoryTraceSink'
import { startRunTrace } from '~/helpers/trace/startRunTrace'
import { slapError } from '~/helpers/errors/slapError'
import { isPromiseLike } from '~/helpers/runner/isPromiseLike'
import { runnerLimitWarnings } from '~/helpers/validation/runnerLimitWarnings'
import { type Normalized, type RunnerEnvironment, type RunState } from '~/helpers/runner/runnerTypes'
import { validateConfig as validateRawConfig } from '~/helpers/validation/validateConfig'
import { resolveGuards } from '~/helpers/validation/resolveGuards'
import { cloneRuntimeVariables } from '~/helpers/runner/cloneRuntimeVariables'
import { createRunCancellation } from '~/helpers/runner/createRunCancellation'
import { createRunState } from '~/helpers/runner/createRunState'
import { createReservedRegistry } from '~/helpers/registry/createReservedRegistry'
import { executeRun } from '~/helpers/runner/executeRun'
import { finishRun } from '~/helpers/runner/finishRun'
import { reportRunError } from '~/helpers/runner/reportRunError'

export const createRunner = <TContext, TPatch = unknown>(
  options: RunnerOptions<TContext, TPatch> = {},
  schedulerRef?: { current?: PoolScheduler }
): Runner<TContext, TPatch> => {
  const actions = createReservedRegistry(BUILTIN_ACTIONS as readonly [string, Action<TContext, TPatch>][], 'action')
  const conditions = createReservedRegistry(
    BUILTIN_CONDITIONS as readonly [string, ConditionFn<TContext>][],
    'condition'
  )
  const configRef: { current?: Config } = {}
  const mergeData = options.mergeData ?? ((current, next) => ({ ...current, ...next }))
  const variables = cloneRuntimeVariables(options.variables ?? {})

  const environment: RunnerEnvironment<TContext, TPatch> = {
    registry: { actions: actions.registry, conditions: conditions.registry },
    validatedConditions: new WeakSet<object>(),
    configRef,
    options,
    mergeData,
  }

  const registerAction = (name: string, action: Action<TContext, TPatch>): void => {
    actions.register(name, action)
  }

  const registerActions = (items: Record<string, Action<TContext, TPatch>>): void => {
    each(
      items,
      (name, action) => {
        registerAction(name, action)
      },
      { shallow: true }
    )
  }

  const registerCondition = (name: string, condition: ConditionFn<TContext>): void => {
    conditions.register(name, condition)
    environment.validatedConditions = new WeakSet<object>()
  }

  const registerConditions = (items: Record<string, ConditionFn<TContext>>): void => {
    each(
      items,
      (name, condition) => {
        registerCondition(name, condition)
      },
      { shallow: true }
    )
  }

  const validateConfig = (target = configRef.current): ValidationResult => {
    const result = validateRawConfig(target, actions.registry, conditions.registry)
    return { ...result, warnings: [...result.warnings, ...runnerLimitWarnings(options)] }
  }

  const loadConfig: Runner<TContext, TPatch>['loadConfig'] = (definition) => {
    const nested = 'config' in definition
    const config = 'strategies' in definition ? definition : definition.config
    const snapshot = snapshotConfig(config)
    const result = validateConfig(snapshot)

    if (nested) {
      result.warnings.push({
        code: 'CONFIG_NESTED_DEPRECATED',
        message: 'Nested config is deprecated. Pass config fields directly on the flow definition.',
        path: 'config',
      })
    }

    configRef.current = resolveGuards(snapshot).config
    environment.validatedConditions = new WeakSet<object>()

    return result
  }

  const runInternal = (
    entrypoint: string,
    context: TContext,
    input: Input,
    sync: boolean,
    runOptions: RunOptions
  ): RunResult<TContext, TPatch> | Promise<RunResult<TContext, TPatch>> => {
    const { trace } = options
    const traceOptions = typeof trace === 'object' && 'level' in trace ? trace : undefined
    const traceSink =
      trace === true || traceOptions?.level === 'tree'
        ? createMemoryTraceSink()
        : typeof trace === 'object' && 'push' in trace
          ? trace
          : undefined
    const finishTrace = traceOptions === undefined ? undefined : startRunTrace(traceOptions, entrypoint, runOptions)
    const cancellation = createRunCancellation(runOptions.signal)
    const state: RunState<TContext, TPatch> = createRunState<TContext, TPatch>({
      context,
      input,
      sync,
      variables,
      expressions: options.expressions ?? {},
      cancellation,
      scheduler: schedulerRef?.current,
      pool: runOptions.pool,
      binding: runOptions.binding,
      traceSink,
    })
    const done = (result: Normalized<TContext, TPatch>): RunResult<TContext, TPatch> => {
      reportRunError(result, state, traceSink, options.onError)
      const runResult = finishRun(result, state, cancellation, traceSink)

      finishTrace?.(runResult)
      return runResult
    }
    const failed = (cause: unknown): never => {
      if (state.traceTiming?.sinkFailure !== undefined) {
        state.closed = true
        cancellation.dispose()
      }

      finishTrace?.({ status: 'failed', events: state.events, timings: state.traceTiming?.entries ?? [] })
      throw cause
    }
    let executed: Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>>

    try {
      executed = executeRun(entrypoint, state, environment)
    } catch (cause) {
      return failed(cause)
    }

    return isPromiseLike(executed) ? executed.then(done, failed) : done(executed)
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

  const runner: Runner<TContext, TPatch> = {
    registerAction,
    registerActions,
    registerCondition,
    registerConditions,
    loadConfig,
    validateConfig,
    run,
    runSync,
  }

  return runner
}
