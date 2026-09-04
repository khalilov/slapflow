export type Input = Record<string, unknown>
export type Props = Record<string, unknown>

export type Config = {
  version?: 1
  strategies: Record<string, Strategy>
  entrypoints?: Record<string, string>
  guards?: Record<string, ConditionExpression>
}

export type Strategy = {
  fn: string
  props?: Props
  when?: ConditionExpression
  then?: Next[]
  catch?: Next[]
  mode?: Mode
  terminal?: boolean
  tags?: string[]
  description?: string
}

export type Mode = 'sequence' | 'selector' | 'parallel'

export type Next =
  | string
  | {
      id?: string
      strategy: string
      props?: Props
      when?: ConditionExpression
    }

export type ConditionExpression = boolean | [operator: string, ...args: unknown[]] | ['guard', name: string]

export type Action<TContext, TPatch = unknown> = (
  args: ActionArgs<TContext>
) => ActionResult<TContext, TPatch> | Promise<ActionResult<TContext, TPatch>>

export type ActionArgs<TContext> = {
  context: TContext
  props: Props
  input: Input
  signal: AbortSignal
  runtime: Runtime
}

export type ActionResult<TContext, TPatch = unknown> =
  void | false | ActionSuccess<TContext, TPatch> | ActionSkip | ActionStop<TPatch> | ActionFail

export type ActionSuccess<TContext, TPatch> = {
  type?: 'success'
  context?: TContext
  data?: Record<string, unknown>
  patch?: TPatch | TPatch[]
  events?: SlapEvent[]
  continue?: boolean
}

export type RuntimeBranchResult =
  | { status: 'success' }
  | { status: 'skipped'; reason?: string }
  | { status: 'stopped'; reason?: string }
  | { status: 'failed'; error: SlapError }

export type ActionSkip = {
  type: 'skip'
  reason?: string
  data?: Record<string, unknown>
}

export type ActionStop<TPatch> = {
  type: 'stop'
  reason?: string
  patch?: TPatch | TPatch[]
  events?: SlapEvent[]
}

export type ActionFail = {
  type: 'fail'
  reason?: string
  error?: unknown
  data?: Record<string, unknown>
  handled?: boolean
}

export type SlapEvent = {
  type: string
  payload?: unknown
}

export type EventMap = Record<string, unknown>

export type EventName<TEvents extends object> = Extract<keyof TEvents, string>

export type EventPattern = `${string}*${string}`

export type BusEvent<TPayload = unknown> = {
  id: string
  topic: string
  occurredAt: number
  origin?: string
  parsed: TPayload
  serialized: string
}

export type EventHandler<TEvents extends object, TEvent extends EventName<TEvents>> = (
  event: BusEvent<TEvents[TEvent]>
) => void

export type BusErrorEvent<TEvents extends object> =
  | {
      type: 'serialization'
      topic: EventName<TEvents>
      payload: TEvents[EventName<TEvents>]
      origin?: string
      error: unknown
    }
  | {
      type: 'subscriber'
      event: BusEvent<TEvents[EventName<TEvents>]>
      error: unknown
    }

export type BusEmitOptions = {
  origin?: string
}

export type BusOptions<TEvents extends object> = {
  onError?: (event: BusErrorEvent<TEvents>) => void
}

export type Bus<TEvents extends object = EventMap> = {
  on: {
    <TEvent extends EventName<TEvents>>(event: TEvent, handler: EventHandler<TEvents, TEvent>): () => void
    (event: EventPattern, handler: (event: BusEvent<unknown>) => void): () => void
  }
  off: {
    <TEvent extends EventName<TEvents>>(event: TEvent, handler?: EventHandler<TEvents, TEvent>): void
    (event: EventPattern, handler?: (event: BusEvent<unknown>) => void): void
  }
  emit<TEvent extends EventName<TEvents>>(
    topic: TEvent,
    payload: TEvents[TEvent],
    options?: BusEmitOptions
  ): BusEvent<TEvents[TEvent]>
  dispatch(event: unknown): BusEvent | undefined
}

export type WSSocket = {
  readyState: number
  send(data: string): void
  close(): void
  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: EventListener): void
  removeEventListener(type: 'open' | 'close' | 'error' | 'message', listener: EventListener): void
}

export type RetryOptions = {
  initialDelay?: number
  maxDelay?: number
  multiplier?: number
  jitter?: boolean
  maxAttempts?: number
}

export type WSRetryOptions = RetryOptions

export type WSOptions<TEvents extends object = EventMap> = {
  bus: Bus<TEvents>
  createSocket: () => WSSocket
  inboundTopics?: (EventName<TEvents> | EventPattern)[]
  outboundTopics?: (EventName<TEvents> | EventPattern)[]
  origin?: string
  retry?: WSRetryOptions
}

export type WSStatus = 'idle' | 'connecting' | 'connected' | 'retrying' | 'stopped'

export type FetchResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'none'

export type WS = {
  start(): void
  stop(): void
  reconnect(): void
  status(): WSStatus
}

export type SocketEventTopic = 'open' | 'message' | 'close' | 'error'

export type WebSocketOptions<TEvents extends object = EventMap> = {
  url: string
  bus: Bus<TEvents>
  origin?: string
  protocols?: string | string[]
  reconnect?: RetryOptions
}

export type WebSocketStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped'

export type WSClient = {
  start(): void
  stop(): void
  reconnect(): void
  status(): WebSocketStatus
}

export type BindingEventMap = Record<string, Input>

export type BusBindingKey<TEvents extends object> = {
  [TEvent in EventName<TEvents>]: TEvents[TEvent] extends Input ? `[bus] ${TEvent}` : never
}[EventName<TEvents>]

export type ConcurrencyMode = 'parallel' | 'latest' | 'queue' | 'drop'

export type QueueOverflow = 'drop-oldest' | 'drop-newest'

export type ConcurrencyOptions<TPayload = Input> = {
  mode?: ConcurrencyMode
  key?: (payload: TPayload) => string
  maxQueueSize?: number
  overflow?: QueueOverflow
}

export type BusBinding<TPayload = Input> = {
  entrypoint: string
  options?: {
    concurrency?: ConcurrencyOptions<TPayload>
  }
}

export type BusBindings<TEvents extends object> = {
  [TBinding in BusBindingKey<TEvents>]?: BusBinding<
    TEvents[Extract<TBinding extends `[bus] ${infer TEvent}` ? TEvent : never, EventName<TEvents>>]
  >
}

export type DomBindingKey = `[dom] ${string}:${string}`

export type DomForm = Record<string, FormDataEntryValue | FormDataEntryValue[]>

export type DomInput = Input & {
  type: string
  value?: string
  dataset: Record<string, string>
  form?: DomForm
}

export type DomBinding = {
  entrypoint: string
  options?: {
    preventDefault?: boolean
    stopPropagation?: boolean
    capture?: boolean
    once?: boolean
    input?: (scope: { event: Event; element: Element; defaultInput: DomInput }) => Input
    concurrency?: ConcurrencyOptions<DomInput>
  }
}

export type DomBindings = Partial<Record<DomBindingKey, DomBinding>>

export type FlowDefinition<TContext, TPatch = unknown, TEvents extends object = BindingEventMap> = {
  config: Config
  actions?: Record<string, Action<TContext, TPatch>>
  conditions?: Record<string, ConditionFn<TContext>>
  events?: BusBindings<TEvents> & DomBindings
}

export type FlowOptions<TContext, TPatch = unknown, TEvents extends object = BindingEventMap> = RunnerOptions<
  TContext,
  TPatch
> & {
  context: TContext | (() => TContext)
  bus?: Bus<TEvents>
  root?: Document | Element
  concurrency?: ConcurrencyOptions
  onRunnerError?: (event: RunnerErrorEvent<TContext, TPatch>) => void
}

export type RunnerErrorEvent<TContext, TPatch = unknown> = {
  error: SlapError
  result: RunResult<TContext, TPatch>
  binding: string
  entrypoint: string
  runId: string
  key?: string
}

export type InactiveBinding = {
  binding: string
  reason: 'unsupported-source' | 'dom-unavailable'
}

export type StartResult = {
  active: string[]
  inactive: InactiveBinding[]
  validation: ValidationResult
}

export type Flow<TContext, TPatch = unknown> = {
  runner: Runner<TContext, TPatch>
  start(): StartResult
  stop(options?: { force?: boolean }): void
}

export type RunResult<TContext, TPatch = unknown> = {
  status: 'success' | 'stopped' | 'failed' | 'skipped'
  context: TContext
  data: Record<string, unknown>
  patches: TPatch[]
  events: SlapEvent[]
  error?: SlapError
  trace?: TraceEntry[]
  steps: number
}

export type Runtime = {
  get(path: string): unknown
  set(path: string, value: unknown): void
  data: {
    get(path: string): unknown
    set(path: string, value: unknown): void
  }
  variables?: {
    get(path: string): unknown
  }
  /** @deprecated Use `runtime.data.get(path)` instead. */
  getData(path: string): unknown
  /** @deprecated Use `runtime.data.set(path, value)` instead. */
  setData(path: string, value: unknown): void
  resolve(value: unknown): unknown
  signal: AbortSignal
  executeThen(): Promise<RuntimeBranchResult>
  executeCatch(): Promise<RuntimeBranchResult | undefined>
  emit(event: SlapEvent): void
  patch(patch: unknown): void
  stop(reason?: string): ActionStop<unknown>
  fail(reason?: string, data?: Record<string, unknown>): ActionFail
}

export type VariableValue =
  string | number | boolean | bigint | null | readonly VariableValue[] | { readonly [key: string]: VariableValue }

export type Variables = Readonly<Record<string, VariableValue>>

export type RunnerOptions<TContext, TPatch> = {
  maxStepCount?: number
  /** @deprecated Use `maxStepCount` instead. */
  maxSteps?: number
  maxDepth?: number
  timeout?: number
  /** @deprecated Use `timeout`. It will be removed in a future major release. */
  timeoutMs?: number
  trace?: boolean | TraceSink
  onError?: ErrorReporter<TContext, TPatch>
  mergeData?: (current: Record<string, unknown>, next: Record<string, unknown>) => Record<string, unknown>
  variables?: Variables
  expressions?: Record<string, ExpressionOperator>
}

export type ExpressionOperator = (args: unknown[]) => unknown

export type RunOptions = {
  signal?: AbortSignal
}

export type TraceSink = {
  push(entry: TraceEntry): void
  entries?(): TraceEntry[]
}

export type TraceEntry = {
  step: number
  depth: number
  strategy: string
  fn: string
  mode: Mode | undefined
  status: 'matched' | 'skipped' | 'success' | 'stopped' | 'failed'
  input: Input
  props: Props
  dataBefore: Record<string, unknown>
  dataAfter: Record<string, unknown>
  durationMs: number
  reason?: string
}

export type SlapError = {
  code: string
  message: string
  strategy?: string
  fn?: string
  stage?: ErrorStage
  cause?: unknown
  path?: string
}

export type ErrorStage = {
  phase: 'entrypoint' | 'condition' | 'action' | 'catch' | 'limit'
  entrypoint?: string | undefined
  strategy?: string | undefined
  fn?: string | undefined
  mode?: Mode | undefined
  step?: number | undefined
  depth?: number | undefined
}

export type SlapErrorEvent<TContext, TPatch = unknown> = {
  error: SlapError
  context: TContext
  input: Input
  data: Record<string, unknown>
  patches: TPatch[]
  events: SlapEvent[]
  trace?: TraceEntry[]
}

export type ErrorReporter<TContext, TPatch = unknown> = (event: SlapErrorEvent<TContext, TPatch>) => void

export type ErrorReporterHandlers<TContext, TPatch = unknown> = {
  report: ErrorReporter<TContext, TPatch>
}

export type ValidationResult = {
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

export type ValidationIssue = {
  code: string
  message: string
  path?: string
  strategy?: string
}

export type ConditionFn<TContext> = (
  context: {
    context: TContext
    input: Input
    data: Record<string, unknown>
    runtime: Pick<Runtime, 'resolve' | 'get' | 'data' | 'variables' | 'getData'>
  },
  ...conditionArgs: unknown[]
) => boolean

export type Runner<TContext, TPatch = unknown> = {
  registerAction(name: string, action: Action<TContext, TPatch>): void
  registerActions(actions: Record<string, Action<TContext, TPatch>>): void
  registerCondition(name: string, condition: ConditionFn<TContext>): void
  registerConditions(conditions: Record<string, ConditionFn<TContext>>): void
  loadConfig(config: Config): ValidationResult
  validateConfig(config?: Config): ValidationResult
  run(entrypoint: string, context: TContext, input?: Input, options?: RunOptions): Promise<RunResult<TContext, TPatch>>
  runSync(entrypoint: string, context: TContext, input?: Input, options?: RunOptions): RunResult<TContext, TPatch>
}
