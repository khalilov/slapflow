import { type ExpressionOperator, type Input, type PoolScheduler, type TraceSink, type Variables } from '~/types'
import { type RunCancellation } from '~/helpers/runner/createRunCancellation'
import { type RunState } from '~/helpers/runner/runnerTypes'
import { createId } from '~/helpers/ids/createId'

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
  parentRunId?: string | undefined
  spawnDepth?: number | undefined
}

export const createRunState = <TContext, TPatch>(args: RunStateArgs<TContext>): RunState<TContext, TPatch> => ({
  context: args.context,
  input: args.input,
  data: {},
  patches: [],
  events: [],
  stepCounter: { current: 0 },
  startedAt: Date.now(),
  sync: args.sync,
  signal: args.cancellation.controller.signal,
  abort: () => args.cancellation.controller.abort(),
  closed: false,
  reportedErrors: [],
  variables: args.variables,
  expressions: args.expressions,
  scheduler: args.scheduler,
  pool: args.pool,
  binding: args.binding,
  runId: createId(),
  parentRunId: args.parentRunId,
  spawnDepth: args.spawnDepth ?? 0,
  ...(args.traceSink ? { traceSink: args.traceSink } : {}),
})
