import { type Normalized } from '~/helpers/runner/runnerTypes'

export const skippedResult = <TContext, TPatch>(
  reason?: string,
  data?: Record<string, unknown>
): Normalized<TContext, TPatch> => ({
  status: 'skipped',
  ...(reason ? { reason } : {}),
  ...(data ? { data } : {}),
})
