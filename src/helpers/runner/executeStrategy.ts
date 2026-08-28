import { type ActionResult, type Props } from '~/types'
import { SyncAsyncError } from '~/errors'
import { afterAction } from '~/helpers/runner/afterAction'
import { slapError } from '~/helpers/errors/slapError'
import { cloneData } from '~/helpers/trace/cloneData'
import { createRuntime } from '~/helpers/runner/createRuntime'
import { defaultMaxDepth, defaultMaxStepCount } from '~/helpers/runner/runnerDefaults'
import { evaluateCondition } from '~/helpers/runner/evaluateCondition'
import { executeSequence } from '~/helpers/runner/executeSequence'
import { executeThen } from '~/helpers/runner/executeThen'
import { failLimit } from '~/helpers/runner/failLimit'
import { handleFailure } from '~/helpers/runner/handleFailure'
import { isPromiseLike } from '~/helpers/runner/isPromiseLike'
import { pushTrace } from '~/helpers/runner/pushTrace'
import { resolveValue } from '~/helpers/path/resolveValue'
import { withErrorStage } from '~/helpers/errors/withErrorStage'
import { ResolutionError } from '~/helpers/path/ResolutionError'
import { redactVariableProps } from '~/helpers/trace/redactVariableProps'
import { toRuntimeResult } from '~/helpers/runner/toRuntimeResult'
import { isTimedOut } from '~/helpers/runner/isTimedOut'
import { raceTimeout } from '~/helpers/runner/raceTimeout'
import { timeoutResult } from '~/helpers/runner/timeoutResult'
import { type Normalized, type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const executeStrategy = <TContext, TPatch>(
  id: string,
  extraProps: Props,
  depth: number,
  state: RunState<TContext, TPatch>,
  environment: RunnerEnvironment<TContext, TPatch>
): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
  const config = environment.configRef.current
  if (!config) {
    return {
      status: 'failed',
      error: slapError('CONFIG_INVALID', 'No config loaded', { stage: { phase: 'entrypoint' } }),
      patches: [],
      events: [],
    }
  }
  const maxDepth = environment.options.maxDepth ?? defaultMaxDepth
  if (maxDepth !== -1 && depth > maxDepth) {
    return failLimit<TContext, TPatch>('MAX_DEPTH', `Max depth exceeded at strategy "${id}"`, id)
  }
  const maxStepCount = environment.options.maxStepCount ?? environment.options.maxSteps ?? defaultMaxStepCount
  if (maxStepCount !== -1 && state.stepCounter.current >= maxStepCount) {
    return failLimit<TContext, TPatch>('MAX_STEPS', `Max steps exceeded at strategy "${id}"`, id)
  }
  if (isTimedOut(state.startedAt, environment.options.timeout)) {
    return timeoutResult<TContext, TPatch>(environment.options.timeout, id)
  }

  const strategy = config.strategies[id]
  if (!strategy) {
    return {
      status: 'failed',
      error: slapError('STRATEGY_NOT_FOUND', `Strategy "${id}" is not defined`, {
        strategy: id,
        stage: { phase: 'entrypoint', strategy: id, depth },
      }),
      patches: [],
      events: [],
    }
  }
  const action = environment.actionsRegistry.get(strategy.fn)
  if (!action) {
    return {
      status: 'failed',
      error: slapError('ACTION_NOT_FOUND', `Action "${strategy.fn}" is not registered`, {
        strategy: id,
        fn: strategy.fn,
        stage: {
          phase: 'action',
          strategy: id,
          fn: strategy.fn,
          mode: strategy.mode,
          depth,
          step: state.stepCounter.current + 1,
        },
      }),
      patches: [],
      events: [],
    }
  }

  const rawProps = { ...(strategy.props ?? {}), ...extraProps }
  let props: Props
  try {
    props = resolveValue(rawProps, {
      ...state,
      strategy: id,
      configPath: `strategies.${id}.props`,
    }) as Props
  } catch (cause) {
    if (!(cause instanceof ResolutionError)) {
      throw cause
    }
    return handleFailure(
      withErrorStage(cause.slapError, {
        phase: 'action',
        strategy: id,
        fn: strategy.fn,
        mode: strategy.mode,
        depth,
        step: state.stepCounter.current + 1,
      }),
      strategy,
      depth,
      state,
      environment
    )
  }
  const traceProps = redactVariableProps(rawProps, props) as Props
  const runtime = createRuntime(state, {
    executeThen: async () => toRuntimeResult(await executeThen(strategy, depth, state, environment)),
    executeCatch: strategy.catch?.length
      ? async () => toRuntimeResult(await executeSequence(strategy.catch!, depth, state, environment))
      : async () => undefined,
  })
  const dataBefore = cloneData(state.data)
  const traceStep = state.stepCounter.current + 1
  const startedAt = Date.now()

  const condition = evaluateCondition(strategy.when, environment.conditionsRegistry, {
    ...state,
    runtime,
    strategy: id,
  })
  if (!condition.ok) {
    return handleFailure(
      withErrorStage(condition.error, {
        phase: 'condition',
        strategy: id,
        fn: strategy.fn,
        mode: strategy.mode,
        depth,
        step: traceStep,
      }),
      strategy,
      depth,
      state,
      environment
    )
  }
  if (!condition.matched) {
    pushTrace(state, traceStep, depth, id, strategy, 'skipped', traceProps, dataBefore, startedAt)
    return { status: 'skipped', reason: 'when condition did not match', patches: [], events: [] }
  }

  state.stepCounter.current += 1
  const invoke = (): ActionResult<TContext, TPatch> | Promise<ActionResult<TContext, TPatch>> =>
    action({ context: state.context, props, input: state.input, signal: state.signal, runtime })

  const actionThrown = (cause: unknown): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
    if (isTimedOut(state.startedAt, environment.options.timeout)) {
      return timeoutResult<TContext, TPatch>(environment.options.timeout, id)
    }

    return handleFailure(
      cause instanceof ResolutionError
        ? withErrorStage(cause.slapError, {
            phase: 'action',
            strategy: id,
            fn: strategy.fn,
            mode: strategy.mode,
            depth,
            step: traceStep,
          })
        : slapError('ACTION_THROWN', `Action "${strategy.fn}" threw`, {
            strategy: id,
            fn: strategy.fn,
            cause,
            stage: { phase: 'action', strategy: id, fn: strategy.fn, mode: strategy.mode, depth, step: traceStep },
          }),
      strategy,
      depth,
      state,
      environment
    )
  }

  try {
    const raw = invoke()
    if (isPromiseLike(raw)) {
      if (state.sync) {
        throw new SyncAsyncError(
          slapError('ASYNC_IN_SYNC_RUN', `Strategy "${id}" returned a Promise`, {
            strategy: id,
            fn: strategy.fn,
            stage: { phase: 'action', strategy: id, fn: strategy.fn, mode: strategy.mode, depth, step: traceStep },
          })
        )
      }
      let timedOut = false
      const complete = raw
        .then((value) => {
          if (timedOut || isTimedOut(state.startedAt, environment.options.timeout)) {
            return timeoutResult<TContext, TPatch>(environment.options.timeout, id)
          }

          return afterAction(
            value,
            id,
            strategy,
            depth,
            state,
            traceProps,
            dataBefore,
            traceStep,
            startedAt,
            environment
          )
        })
        .catch((cause) => {
          if (timedOut || isTimedOut(state.startedAt, environment.options.timeout)) {
            return timeoutResult<TContext, TPatch>(environment.options.timeout, id)
          }

          return actionThrown(cause)
        })
      const timeout = environment.options.timeout

      if (timeout !== undefined && timeout > 0) {
        return raceTimeout(complete, timeout, state.startedAt, () => {
          timedOut = true
          state.closed = true
          state.abort()

          return timeoutResult<TContext, TPatch>(timeout, id)
        })
      }

      return complete
    }
    if (isTimedOut(state.startedAt, environment.options.timeout)) {
      return timeoutResult<TContext, TPatch>(environment.options.timeout, id)
    }

    return afterAction(raw, id, strategy, depth, state, traceProps, dataBefore, traceStep, startedAt, environment)
  } catch (cause) {
    if (cause instanceof SyncAsyncError) {
      throw cause
    }
    return actionThrown(cause)
  }
}
