import { type RuntimeBranchResult } from '~/types'
import { type Normalized } from '~/helpers/runner/runnerTypes'

export const toRuntimeResult = <TContext, TPatch>(
  result: Normalized<TContext, TPatch>
): RuntimeBranchResult => {
  if (result.status === 'failed') {
    return { status: 'failed', error: result.error }
  }
  if (result.status === 'stopped') {
    return { status: 'stopped', ...('reason' in result && result.reason ? { reason: result.reason } : {}) }
  }
  if (result.status === 'skipped') {
    return { status: 'skipped', ...(result.reason ? { reason: result.reason } : {}) }
  }
  return { status: 'success' }
}
