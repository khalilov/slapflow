import { type ExpressionOperator, type Input, type PoolScheduler, type TraceSink, type Variables } from '~/types'
import { type RunCancellation } from '~/helpers/runner/createRunCancellation'
import { type RunState } from '~/helpers/runner/runnerTypes'

export type RunStateArgs<TContext> = {
  context: TContext
  input: Input
  sync: boolean
  variables: Variables
  expressions: Record<string, ExpressionOperator>
  cancellation: RunCancellation
  scheduler?: PoolScheduler | undefined
  pool?: string | undefined
  binding?: string | undefined
  traceSink?: TraceSink | undefined
}

export const createRunState = <TContext, TPatch>({
  context,
  input,
  sync,
  variables,
  expressions,
  cancellation: { controller },
  scheduler,
  pool,
  binding,
  traceSink,
}: RunStateArgs<TContext>): RunState<TContext, TPatch> => ({
  context,
  input,
  data: {},
  patches: [],
  events: [],
  stepCounter: { current: 0 },
  startedAt: Date.now(),
  sync,
  signal: controller.signal,
  abort: () => controller.abort(),
  closed: false,
  reportedErrors: [],
  variables,
  expressions,
  scheduler,
  pool,
  binding,
  ...(traceSink !== undefined
    ? { traceSink, traceTiming: { nextInvocationId: 1, startedAt: performance.now(), entries: [] } }
    : {}),
})
