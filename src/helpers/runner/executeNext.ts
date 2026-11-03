import { type Next } from '~/types'
import { evaluateConditionWithRegistry } from '~/helpers/conditions/evaluateConditionWithRegistry'
import { isBuiltinConditionTree } from '~/helpers/conditions/isBuiltinConditionTree'
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
    const runtime =
      state.traceSink === undefined && isBuiltinConditionTree(item.when) ? undefined : createRuntime(state)
    const condition = evaluateConditionWithRegistry(
      item.when,
      {
        ...state,
        ...(runtime === undefined ? {} : { runtime }),
        strategy: id,
        types: environment.configRef.current?.types,
      },
      {
        conditions: environment.registry.conditions,
        expressions: state.expressions,
      },
      environment.validatedConditions
    )

    if (!condition.ok) {
      return { status: 'failed', error: condition.error }
    }
    if (!condition.matched) {
      return {
        status: 'skipped',
        reason: 'next condition did not match',
      }
    }
  }
  const extraProps = typeof item === 'string' ? {} : (item.props ?? {})

  return executeStrategy(id, extraProps, depth, state, environment)
}
