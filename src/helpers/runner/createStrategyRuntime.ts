import { type Input, type Runtime, type Strategy } from '~/types'
import { createRuntime } from '~/helpers/runner/createRuntime'
import { type EvaluationRuntime } from '~/helpers/path/createEvaluationRuntime'
import { executeThen } from '~/helpers/runner/executeThen'
import { executeSequence } from '~/helpers/runner/executeSequence'
import { toRuntimeResult } from '~/helpers/runner/toRuntimeResult'
import { type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const createStrategyRuntime = <TContext, TPatch>(
  strategy: Strategy,
  depth: number,
  state: RunState<TContext, TPatch>,
  environment: RunnerEnvironment<TContext, TPatch>,
  evaluationRuntime: EvaluationRuntime
): Runtime => {
  return createRuntime(
    state,
    {
      executeThen: async (options) => {
        if (options && 'input' in options) {
          const { input } = state

          state.input = options.input as Input
          try {
            return toRuntimeResult(await executeThen(strategy, depth, state, environment))
          } finally {
            state.input = input
          }
        }

        return toRuntimeResult(await executeThen(strategy, depth, state, environment))
      },
      executeCatch: strategy.catch?.length
        ? async () => toRuntimeResult(await executeSequence(strategy.catch!, depth, state, environment))
        : async () => undefined,
    },
    evaluationRuntime
  )
}
