import { type Next } from '~/types'
import { evaluateCondition } from '~/helpers/runner/evaluateCondition'
import { createRuntime } from '~/helpers/runner/createRuntime'
import { executeStrategy } from '~/helpers/runner/executeStrategy'
import { type Normalized, type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const executeNext = <TContext, TPatch>(
  item: Next,
  depth: number,
  state: RunState<TContext, TPatch>,
  environment: RunnerEnvironment<TContext, TPatch>
): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
  const id = typeof item === 'string' ? item : item.strategy

  if (typeof item !== 'string' && item.when) {
    const runtime = createRuntime(state)
    const condition = evaluateCondition(item.when, environment.registry.conditions, { ...state, runtime, strategy: id })

    if (!condition.ok) {
      return { status: 'failed', error: condition.error, patches: [], events: [] }
    }
    if (!condition.matched) {
      return {
        status: 'skipped',
        reason: 'next condition did not match',
        patches: [],
        events: [],
      }
    }
  }
  const extraProps = typeof item === 'string' ? {} : (item.props ?? {})

  return executeStrategy(id, extraProps, depth, state, environment)
}
