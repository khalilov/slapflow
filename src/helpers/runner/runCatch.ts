import { type Strategy } from '~/types'
import { executeSequence } from '~/helpers/runner/executeSequence'
import { isPromiseLike } from '~/helpers/runner/isPromiseLike'
import { type Normalized, type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const runCatch = <TContext, TPatch>(
  strategy: Strategy,
  depth: number,
  state: RunState<TContext, TPatch>,
  environment: RunnerEnvironment<TContext, TPatch>
): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
  const caught = executeSequence(strategy.catch!, depth, state, environment)
  const stageCatchFailure = (result: Normalized<TContext, TPatch>): Normalized<TContext, TPatch> => {
    if (result.status === 'failed') {
      return {
        ...result,
        error: {
          ...result.error,
          stage: {
            ...result.error.stage,
            phase: 'catch',
          },
        },
      }
    }

    return result
  }

  return isPromiseLike(caught) ? caught.then(stageCatchFailure) : stageCatchFailure(caught)
}
