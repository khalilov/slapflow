import { type ErrorReporter, type TraceSink } from '~/types'
import { type Normalized, type RunState } from '~/helpers/runner/runnerTypes'

export const reportRunError = <TContext, TPatch>(
  result: Normalized<TContext, TPatch>,
  state: RunState<TContext, TPatch>,
  traceSink: TraceSink | undefined,
  onError: ErrorReporter<TContext, TPatch> | undefined
): void => {
  if (result.status !== 'failed' || state.reportedErrors.includes(result.error)) {
    return
  }
  state.reportedErrors.push(result.error)
  onError?.({
    error: result.error,
    context: state.context,
    input: state.input,
    data: state.data,
    patches: state.patches,
    events: state.events,
    ...(traceSink?.entries ? { trace: traceSink.entries() } : {}),
  })
}
