import { executeStrategy } from '~/helpers/runner/executeStrategy'
import { resolveEntrypoint } from '~/helpers/runner/resolveEntrypoint'
import { type Normalized, type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const executeRun = <TContext, TPatch>(
  entrypoint: string,
  state: RunState<TContext, TPatch>,
  environment: RunnerEnvironment<TContext, TPatch>
): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
  const start = resolveEntrypoint(entrypoint, environment)

  if ('error' in start) {
    return { status: 'failed', error: start.error, patches: [], events: [] }
  }

  return executeStrategy(start.id, {}, 0, state, environment)
}
