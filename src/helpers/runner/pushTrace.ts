import { type Mode, type Props, type Strategy } from '~/types'
import { cloneData } from '~/helpers/trace/cloneData'
import { type RunState } from '~/helpers/runner/runnerTypes'

export const pushTrace = <TContext, TPatch>(
  state: RunState<TContext, TPatch>,
  step: number,
  depth: number,
  strategyId: string,
  strategy: Strategy,
  status: 'matched' | 'skipped' | 'success' | 'stopped' | 'failed',
  props: Props,
  dataBefore: Record<string, unknown>,
  startedAt: number,
  reason?: string
): void => {
  state.traceSink?.push({
    step,
    depth,
    strategy: strategyId,
    fn: strategy.fn,
    mode: strategy.mode as Mode | undefined,
    status,
    input: state.input,
    props,
    dataBefore,
    dataAfter: cloneData(state.data),
    durationMs: Date.now() - startedAt,
    ...(reason ? { reason } : {}),
  })
}
