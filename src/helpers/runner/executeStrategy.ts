import { type Props, type StrategyTiming } from '~/types'
import { executeStrategyBody } from '~/helpers/runner/executeStrategyBody'
import { finishStrategyTiming } from '~/helpers/runner/finishStrategyTiming'
import { isPromiseLike } from '~/helpers/runner/isPromiseLike'
import { type Normalized, type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const executeStrategy = <TContext, TPatch>(
  id: string,
  extraProps: Props,
  depth: number,
  state: RunState<TContext, TPatch>,
  environment: RunnerEnvironment<TContext, TPatch>
): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
  const { traceTiming, traceSink } = state

  if (traceTiming !== undefined) {
    const { nextInvocationId } = traceTiming
    const startedAt = performance.now()
    const entry: StrategyTiming = {
      invocationId: nextInvocationId,
      parentInvocationId: environment.parentInvocationId ?? null,
      strategy: id,
      depth,
      startedAtMs: startedAt - traceTiming.startedAt,
      durationMs: 0,
      status: 'failed',
    }
    const branchEnvironment = { ...environment, parentInvocationId: nextInvocationId }
    const complete = (result: Normalized<TContext, TPatch>): Normalized<TContext, TPatch> => {
      entry.status = result.status
      finishStrategyTiming(entry, startedAt, traceTiming, traceSink)

      return result
    }
    const failed = (cause: unknown): never => {
      try {
        finishStrategyTiming(entry, startedAt, traceTiming, traceSink)
      } catch {
        // Preserve the invocation error through ancestor action handlers too.
        traceTiming.sinkFailure = { cause }
      }

      throw cause
    }
    let result: Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>>

    traceTiming.nextInvocationId += 1
    try {
      result = executeStrategyBody(id, extraProps, depth, state, branchEnvironment)
    } catch (cause) {
      return failed(cause)
    }

    return isPromiseLike(result) ? result.then(complete, failed) : complete(result)
  }

  return executeStrategyBody(id, extraProps, depth, state, environment)
}
