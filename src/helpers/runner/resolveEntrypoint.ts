import { type SlapError } from '~/types'
import { slapError } from '~/helpers/errors/slapError'
import { type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const resolveEntrypoint = <TContext, TPatch>(
  entrypoint: string,
  environment: RunnerEnvironment<TContext, TPatch>
): { id: string } | { error: SlapError } => {
  const config = environment.configRef.current

  if (!config) {
    return { error: slapError('CONFIG_INVALID', 'No config loaded', { stage: { phase: 'entrypoint' } }) }
  }
  const id = config.entrypoints?.[entrypoint] ?? entrypoint

  if (!config.strategies[id]) {
    return {
      error: slapError('STRATEGY_NOT_FOUND', `Strategy "${id}" is not defined`, {
        strategy: id,
        stage: { phase: 'entrypoint', entrypoint, strategy: id },
      }),
    }
  }

  return { id }
}
