import { type Next } from '~/types'
import { executeNext } from '~/helpers/runner/executeNext'
import { isPromiseLike } from '~/helpers/runner/isPromiseLike'
import { type Normalized, type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const executeSelector = <TContext, TPatch>(
  items: Next[],
  depth: number,
  state: RunState<TContext, TPatch>,
  environment: RunnerEnvironment<TContext, TPatch>
): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
  let index = 0
  const loop = (): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
    if (index >= items.length) {
      return { status: 'skipped', reason: 'No selector branch matched', patches: [], events: [] }
    }
    const result = executeNext(items[index++]!, depth + 1, state, environment)
    const next = (value: Normalized<TContext, TPatch>) => {
      if (value.status === 'skipped') {
        return loop()
      }
      return value
    }
    return isPromiseLike(result) ? result.then(next) : next(result)
  }
  return loop()
}
