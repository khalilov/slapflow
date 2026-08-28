import { type SlapError, type Strategy } from '~/types'
import { executeSequence } from '~/helpers/runner/executeSequence'
import { withErrorStage } from '~/helpers/errors/withErrorStage'
import { isPromiseLike } from '~/helpers/runner/isPromiseLike'
import { type Normalized, type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const handleFailure = <TContext, TPatch>(
  error: SlapError,
  strategy: Strategy,
  depth: number,
  state: RunState<TContext, TPatch>,
  environment: RunnerEnvironment<TContext, TPatch>
): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
  const stagedError = withErrorStage(error, {
    phase: error.stage?.phase ?? 'action',
    strategy: error.strategy,
    fn: error.fn ?? strategy.fn,
    mode: strategy.mode,
    depth,
    step: state.stepCounter.current,
  })
  environment.options.onError?.({
    error: stagedError,
    context: state.context,
    input: state.input,
    data: state.data,
    patches: state.patches,
    events: state.events,
    ...(state.traceSink?.entries ? { trace: state.traceSink.entries() } : {}),
  })
  state.reportedErrors.push(stagedError)
  if (strategy.catch?.length) {
    const caught = executeSequence(strategy.catch, depth, state, environment)
    const stageCatchFailure = (result: Normalized<TContext, TPatch>): Normalized<TContext, TPatch> => {
      if (result.status === 'failed') {
        return {
          ...result,
          error: {
            ...result.error,
            stage: {
              ...result.error.stage,
              phase: 'catch',
            },
          },
        }
      }

      return result
    }

    return isPromiseLike(caught) ? caught.then(stageCatchFailure) : stageCatchFailure(caught)
  }
  return { status: 'failed', error: stagedError, patches: [], events: [] }
}
