import { type RunnerOptions } from '~/types'

export const normalizeRunnerOptions = <TContext, TPatch>(
  options: RunnerOptions<TContext, TPatch>
): RunnerOptions<TContext, TPatch> => {
  const timeout = options.timeout ?? options.timeoutMs

  if (options.timeoutMs !== undefined) {
    console.warn('timeoutMs is deprecated; use timeout. It will be removed in a future major release.')
  }

  return timeout === undefined ? options : { ...options, timeout }
}
