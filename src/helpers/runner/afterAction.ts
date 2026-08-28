import { type ActionResult, type Props, type Strategy } from '~/types'
import { applyResult } from '~/helpers/runner/applyResult'
import { executeThen } from '~/helpers/runner/executeThen'
import { handleFailure } from '~/helpers/runner/handleFailure'
import { normalizeActionResult } from '~/helpers/runner/normalizeActionResult'
import { pushTrace } from '~/helpers/runner/pushTrace'
import { traceReason } from '~/helpers/runner/traceReason'
import { withErrorStage } from '~/helpers/errors/withErrorStage'
import { type Normalized, type RunState, type RunnerEnvironment } from '~/helpers/runner/runnerTypes'

export const afterAction = <TContext, TPatch>(
  raw: ActionResult<TContext, TPatch>,
  id: string,
  strategy: Strategy,
  depth: number,
  state: RunState<TContext, TPatch>,
  props: Props,
  dataBefore: Record<string, unknown>,
  traceStep: number,
  startedAt: number,
  environment: RunnerEnvironment<TContext, TPatch>
): Normalized<TContext, TPatch> | Promise<Normalized<TContext, TPatch>> => {
  const result = normalizeActionResult(raw)
  const reason = traceReason(result)

  if (result.status === 'failed') {
    result.error = withErrorStage(result.error, {
      phase: 'action',
      strategy: id,
      fn: strategy.fn,
      mode: strategy.mode,
      depth,
      step: traceStep,
    })
  }

  applyResult(result, state, environment.mergeData)

  pushTrace(
    state,
    traceStep,
    depth,
    id,
    strategy,
    result.status === 'success' ? 'success' : result.status,
    props,
    dataBefore,
    startedAt,
    reason
  )

  if (result.status === 'failed') {
    return result.handled ? result : handleFailure(result.error, strategy, depth, state, environment)
  }

  if (result.status === 'skipped' || result.status === 'stopped' || strategy.terminal || result.continue === false) {
    return result
  }

  return executeThen(strategy, depth, state, environment)
}
