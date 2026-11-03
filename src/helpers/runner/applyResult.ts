import { type Normalized, type RunState } from '~/helpers/runner/runnerTypes'

export const applyResult = <TContext, TPatch>(
  result: Normalized<TContext, TPatch>,
  state: RunState<TContext, TPatch>,
  mergeData: (current: Record<string, unknown>, next: Record<string, unknown>) => Record<string, unknown>
): void => {
  if (result.status === 'success' && result.context !== undefined) {
    state.context = result.context
  }
  if ('data' in result && result.data) {
    state.data = mergeData(state.data, result.data)
  }
  if (result.patches !== undefined) {
    state.patches.push(...result.patches)
  }
  if (result.events !== undefined) {
    state.events.push(...result.events)
  }
}
