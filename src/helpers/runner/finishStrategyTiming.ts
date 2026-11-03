import { type StrategyTiming, type TraceSink } from '~/types'
import { type TraceTimingState } from '~/helpers/runner/runnerTypes'

export const finishStrategyTiming = (
  entry: StrategyTiming,
  startedAt: number,
  traceTiming: TraceTimingState,
  traceSink: TraceSink | undefined
): void => {
  entry.durationMs = performance.now() - startedAt
  traceTiming.entries.push(entry)
  try {
    traceSink?.pushTiming?.(entry)
  } catch (cause) {
    // Keep timing sink failures outside the action error/catch path, including ancestors.
    traceTiming.sinkFailure ??= { cause }
    throw cause
  }
}
