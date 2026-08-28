import { failLimit } from '~/helpers/runner/failLimit'
import { type Normalized } from '~/helpers/runner/runnerTypes'

export const timeoutResult = <TContext, TPatch>(
  timeout: number | undefined,
  strategy: string
): Normalized<TContext, TPatch> =>
  failLimit<TContext, TPatch>('TIMEOUT', `Slapflow run timed out after ${timeout}ms`, strategy)
