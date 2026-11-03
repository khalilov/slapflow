import { type ActionResult, type ConditionOutcome, type Props, type Runtime } from '~/types'
import { tools } from '~/helpers/tools'
import { SyncAsyncError } from '~/helpers/errors/syncAsyncError'
import { afterAction } from '~/helpers/runner/afterAction'
import { slapError } from '~/helpers/errors/slapError'
import { cloneData } from '~/helpers/trace/cloneData'
import { createStrategyRuntime } from '~/helpers/runner/createStrategyRuntime'
import { createEvaluationRuntime, type EvaluationRuntime } from '~/helpers/path/createEvaluationRuntime'
import { defaultMaxDepth, defaultMaxStepCount } from '~/helpers/runner/runnerDefaults'
import { isBuiltinConditionTree } from '~/helpers/conditions/isBuiltinConditionTree'
import { evaluateConditionWithRegistry } from '~/helpers/conditions/evaluateConditionWithRegistry'
import { failLimit } from '~/helpers/runner/failLimit'
import { handleFailure } from '~/helpers/runner/handleFailure'
import { runCatch } from '~/helpers/runner/runCatch'
import { isPromiseLike } from '~/helpers/runner/isPromiseLike'
import { pushTrace } from '~/helpers/runner/pushTrace'
import { resolveValue } from '~/helpers/path/resolveValue'
import { withErrorStage } from '~/helpers/errors/withErrorStage'
import { ResolutionError } from '~/helpers/path/ResolutionError'
import { EnqueueError } from '~/helpers/errors/EnqueueError'
import { redactVariableProps } from '~/helpers/trace/redactVariableProps'
import { isTimedOut } from '~/helpers/runner/isTimedOut'
import { raceTimeout } from '~/helpers/runner/raceTimeout'
import { timeoutResult } from '~/helpers/runner/timeoutResult'
import { type Normalized, type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const executeStrategyBody = <TContext, TPatch>(
  id: string,
  extraProps: Props,
  depth: number,
  state: RunState<TContext, TPatch>,
  environment: RunnerEnvironment<TContext, TPatch>
): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
  const { current } = environment.configRef

  if (current) {
    const maxDepth = environment.options.maxDepth ?? defaultMaxDepth

    if (maxDepth === -1 || depth > maxDepth === false) {
      const maxStepCount = environment.options.maxStepCount ?? environment.options.maxSteps ?? defaultMaxStepCount

      if (maxStepCount === -1 || state.stepCounter.current >= maxStepCount === false) {
        if (isTimedOut(state.startedAt, environment.options.timeout) === false) {
          const { [id]: strategy } = current.strategies

          if (strategy) {
            const action = environment.registry.actions.get(strategy.fn)

            if (action) {
              const rawProps = { ...(strategy.props ?? {}), ...extraProps }
              let props: Props
              let traceProps: Props
              let deferRuntime: boolean
              let evaluationRuntime: EvaluationRuntime
              let runtime: Runtime | undefined
              let dataBefore: Record<string, unknown>
              let traceStep: number
              let startedAt: number
              let condition: ConditionOutcome

              try {
                props =
                  Reflect.ownKeys(rawProps).length === 0
                    ? rawProps
                    : (resolveValue(rawProps, {
                        ...state,
                        strategy: id,
                        configPath: `strategies.${id}.props`,
                      }) as Props)
              } catch (cause) {
                if (cause instanceof ResolutionError) {
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

                throw cause
              }
              traceProps = state.traceSink !== undefined ? (redactVariableProps(rawProps, props) as Props) : props
              deferRuntime =
                state.traceSink === undefined && strategy.when !== undefined && isBuiltinConditionTree(strategy.when)
              evaluationRuntime = createEvaluationRuntime(state)
              runtime = deferRuntime
                ? undefined
                : createStrategyRuntime(strategy, depth, state, environment, evaluationRuntime)
              dataBefore = state.traceSink !== undefined ? cloneData(state.data) : {}
              traceStep = state.stepCounter.current + 1
              startedAt = state.traceSink !== undefined ? Date.now() : 0

              condition =
                strategy.when === undefined
                  ? { ok: true, matched: true }
                  : evaluateConditionWithRegistry(
                      strategy.when,
                      {
                        ...state,
                        runtime: runtime ?? evaluationRuntime,
                        strategy: id,
                        types: current.types,
                      },
                      {
                        conditions: environment.registry.conditions,
                        expressions: state.expressions,
                      },
                      environment.validatedConditions
                    )
              if (condition.ok) {
                if (condition.matched) {
                  const actionRuntime =
                    runtime ?? createStrategyRuntime(strategy, depth, state, environment, evaluationRuntime)

                  const invoke = (): ActionResult<TContext, TPatch> | Promise<ActionResult<TContext, TPatch>> =>
                    action({
                      context: state.context,
                      props,
                      input: state.input,
                      signal: state.signal,
                      runtime: actionRuntime,
                      tools,
                    })

                  const actionThrown = (
                    cause: unknown
                  ): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
                    const { traceTiming } = state

                    if (traceTiming?.sinkFailure !== undefined) {
                      throw traceTiming.sinkFailure.cause
                    }
                    if (isTimedOut(state.startedAt, environment.options.timeout)) {
                      return timeoutResult<TContext, TPatch>(environment.options.timeout, id)
                    }

                    return handleFailure(
                      cause instanceof ResolutionError || cause instanceof EnqueueError
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
                            stage: {
                              phase: 'action',
                              strategy: id,
                              fn: strategy.fn,
                              mode: strategy.mode,
                              depth,
                              step: traceStep,
                            },
                          }),
                      strategy,
                      depth,
                      state,
                      environment
                    )
                  }

                  state.stepCounter.current += 1
                  try {
                    const raw = invoke()

                    if (state.traceTiming?.sinkFailure !== undefined) {
                      throw state.traceTiming.sinkFailure.cause
                    }
                    if (isPromiseLike(raw)) {
                      let timedOut = false
                      let complete: Promise<Normalized<TContext, TPatch>>
                      let timeout: number | undefined

                      if (state.sync) {
                        throw new SyncAsyncError(
                          slapError('ASYNC_IN_SYNC_RUN', `Strategy "${id}" returned a Promise`, {
                            strategy: id,
                            fn: strategy.fn,
                            stage: {
                              phase: 'action',
                              strategy: id,
                              fn: strategy.fn,
                              mode: strategy.mode,
                              depth,
                              step: traceStep,
                            },
                          })
                        )
                      }
                      complete = raw
                        .then((value) => {
                          if (state.traceTiming?.sinkFailure !== undefined) {
                            throw state.traceTiming.sinkFailure.cause
                          }
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
                          if (state.traceTiming?.sinkFailure !== undefined) {
                            throw state.traceTiming.sinkFailure.cause
                          }
                          if (timedOut || isTimedOut(state.startedAt, environment.options.timeout)) {
                            return timeoutResult<TContext, TPatch>(environment.options.timeout, id)
                          }

                          return actionThrown(cause)
                        })
                      ;({ timeout } = environment.options)

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

                    return afterAction(
                      raw,
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
                  } catch (cause) {
                    if (cause instanceof SyncAsyncError) {
                      throw cause
                    }
                    return actionThrown(cause)
                  }
                }

                if (condition.ensure) {
                  pushTrace(
                    state,
                    traceStep,
                    depth,
                    id,
                    strategy,
                    'failed',
                    traceProps,
                    dataBefore,
                    startedAt,
                    'ensure did not match'
                  )
                  if (strategy.catch?.length) {
                    return runCatch(strategy, depth, state, environment)
                  }

                  return {
                    status: 'failed',
                    error: slapError('ENSURE_FAILED', `ensure condition did not match at strategy "${id}"`, {
                      strategy: id,
                      fn: strategy.fn,
                      stage: {
                        phase: 'condition',
                        strategy: id,
                        fn: strategy.fn,
                        mode: strategy.mode,
                        depth,
                        step: traceStep,
                      },
                    }),
                  }
                }

                pushTrace(state, traceStep, depth, id, strategy, 'skipped', traceProps, dataBefore, startedAt)
                return { status: 'skipped', reason: 'when condition did not match' }
              }

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
            }
          }

          return {
            status: 'failed',
            error: slapError('STRATEGY_NOT_FOUND', `Strategy "${id}" is not defined`, {
              strategy: id,
              stage: { phase: 'entrypoint', strategy: id, depth },
            }),
          }
        }

        return timeoutResult<TContext, TPatch>(environment.options.timeout, id)
      }

      return failLimit<TContext, TPatch>('MAX_STEPS', `Max steps exceeded at strategy "${id}"`, id)
    }

    return failLimit<TContext, TPatch>('MAX_DEPTH', `Max depth exceeded at strategy "${id}"`, id)
  }

  return {
    status: 'failed',
    error: slapError('CONFIG_INVALID', 'No config loaded', { stage: { phase: 'entrypoint' } }),
  }
}
