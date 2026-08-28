import { type Normalized } from '~/helpers/runner/runnerTypes'
import { slapError } from '~/helpers/errors/slapError'

export const failLimit = <TContext, TPatch>(
  code: string,
  message: string,
  id: string
): Normalized<TContext, TPatch> => ({
  status: 'failed',
  error: slapError(code, message, { strategy: id, stage: { phase: 'limit', strategy: id } }),
  patches: [],
  events: [],
})
