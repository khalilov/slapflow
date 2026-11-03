import {
  type Config,
  type SlapError,
  type SlapEvent,
  type Input,
  type PoolScheduler,
  type RunnerOptions,
  type TraceSink,
  type StrategyTiming,
  type Variables,
} from '~/types'
import { type ActionsRegistry } from '~/helpers/actions'
import { type ConditionsRegistry } from '~/helpers/conditions'

export type Normalized<TContext, TPatch> =
  | {
      status: 'success'
      context?: TContext
      data?: Record<string, unknown>
      continue?: boolean
      patches?: TPatch[] | undefined
      events?: [] | SlapEvent[] | undefined
    }
  | {
      status: 'skipped'
      reason?: string
      data?: Record<string, unknown>
      patches?: TPatch[] | undefined
      events?: [] | undefined
    }
  | { status: 'stopped'; reason?: string; patches?: TPatch[] | undefined; events?: [] | SlapEvent[] | undefined }
  | {
      status: 'failed'
      error: SlapError
      data?: Record<string, unknown>
      handled?: boolean
      patches?: TPatch[] | undefined
      events?: [] | undefined
    }

export type TraceTimingState = {
  nextInvocationId: number
  startedAt: number
  entries: StrategyTiming[]
  sinkFailure?: { cause: unknown }
}

export type RunState<TContext, TPatch> = {
  context: TContext
  input: Input
  data: Record<string, unknown>
  patches: TPatch[]
  events: SlapEvent[]
  stepCounter: { current: number }
  startedAt: number
  sync: boolean
  signal: AbortSignal
  abort(): void
  closed: boolean
  reportedErrors: SlapError[]
  variables: Variables
  expressions: Record<string, import('~/types').ExpressionOperator>
  traceTiming?: TraceTimingState
  traceSink?: TraceSink
  scheduler?: PoolScheduler | undefined
  pool?: string | undefined
  binding?: string | undefined
}

export type RunnerEnvironment<TContext, TPatch> = {
  validatedConditions: WeakSet<object>
  parentInvocationId?: number
  registry: {
    actions: ActionsRegistry<TContext, TPatch>
    conditions: ConditionsRegistry<TContext>
  }
  configRef: { current?: Config }
  options: RunnerOptions<TContext, TPatch>
  mergeData: (current: Record<string, unknown>, next: Record<string, unknown>) => Record<string, unknown>
}
