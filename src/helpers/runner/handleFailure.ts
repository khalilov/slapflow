import { type SlapError, type Strategy } from '~/types'
import { withErrorStage } from '~/helpers/errors/withErrorStage'
import { runCatch } from '~/helpers/runner/runCatch'
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
    return runCatch(strategy, depth, state, environment)
  }
  return { status: 'failed', error: stagedError, patches: [], events: [] }
}
