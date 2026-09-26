import { executeStrategy } from '~/helpers/runner/executeStrategy'
import { resolveEntrypoint } from '~/helpers/runner/resolveEntrypoint'
import { failLimit } from '~/helpers/runner/failLimit'
import { defaultMaxSpawnDepth } from '~/helpers/runner/runnerDefaults'
import { type Normalized, type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const executeRun = <TContext, TPatch>(
  entrypoint: string,
  state: RunState<TContext, TPatch>,
  environment: RunnerEnvironment<TContext, TPatch>
): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
  const maxSpawnDepth = environment.options.maxSpawnDepth ?? defaultMaxSpawnDepth

  if (maxSpawnDepth !== -1 && state.spawnDepth > maxSpawnDepth) {
    return failLimit<TContext, TPatch>(
      'MAX_SPAWN_DEPTH',
      `Max spawn depth exceeded at entrypoint "${entrypoint}"`,
      entrypoint
    )
  }

  const start = resolveEntrypoint(entrypoint, environment)

  if ('error' in start) {
    return { status: 'failed', error: start.error, patches: [], events: [] }
  }

  return executeStrategy(start.id, {}, 0, state, environment)
}
