import { type RunResult, type TraceSink } from '~/types'
import { finishRunResult } from '~/helpers/runner/finishRunResult'
import { type RunCancellation } from '~/helpers/runner/createRunCancellation'
import { type Normalized, type RunState } from '~/helpers/runner/runnerTypes'

export const finishRun = <TContext, TPatch>(
  result: Normalized<TContext, TPatch>,
  state: RunState<TContext, TPatch>,
  cancellation: RunCancellation,
  traceSink: TraceSink | undefined
): RunResult<TContext, TPatch> => {
  state.closed = true
  cancellation.dispose()

  return finishRunResult(result, state, traceSink)
}
