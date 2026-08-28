import {
  type Config,
  type SlapError,
  type SlapEvent,
  type Input,
  type RunnerOptions,
  type TraceSink,
  type Variables,
} from '~/types'
import { type ActionsRegistry } from '~/registry/actions'
import { type ConditionsRegistry } from '~/registry/conditions'

export type Normalized<TContext, TPatch> =
  | {
      status: 'success'
      context?: TContext
      data?: Record<string, unknown>
      continue?: boolean
      patches: TPatch[]
      events: [] | SlapEvent[]
    }
  | { status: 'skipped'; reason?: string; data?: Record<string, unknown>; patches: TPatch[]; events: [] }
  | { status: 'stopped'; reason?: string; patches: TPatch[]; events: [] | SlapEvent[] }
  | {
      status: 'failed'
      error: SlapError
      data?: Record<string, unknown>
      handled?: boolean
      patches: TPatch[]
      events: []
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
  traceSink?: TraceSink
}

export type RunnerEnvironment<TContext, TPatch> = {
  actionsRegistry: ActionsRegistry<TContext, TPatch>
  conditionsRegistry: ConditionsRegistry<TContext>
  configRef: { current?: Config }
  options: RunnerOptions<TContext, TPatch>
  mergeData: (current: Record<string, unknown>, next: Record<string, unknown>) => Record<string, unknown>
}
