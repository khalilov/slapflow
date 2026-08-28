import { type Strategy } from '~/types'
import { executeParallel } from '~/helpers/runner/executeParallel'
import { executeSelector } from '~/helpers/runner/executeSelector'
import { executeSequence } from '~/helpers/runner/executeSequence'
import { type Normalized, type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const executeThen = <TContext, TPatch>(
  strategy: Strategy,
  depth: number,
  state: RunState<TContext, TPatch>,
  environment: RunnerEnvironment<TContext, TPatch>
): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
  const items = strategy.then ?? []

  if (items.length === 0) {
    return { status: 'success', patches: [], events: [] }
  }
  const mode = strategy.mode ?? 'sequence'

  if (mode === 'selector') {
    return executeSelector(items, depth, state, environment)
  }
  if (mode === 'parallel') {
    return executeParallel(items, depth, state, environment)
  }

  return executeSequence(items, depth, state, environment)
}
