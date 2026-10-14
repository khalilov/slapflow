import { set } from 'objwalk'
import { type EnqueueOptions, type Input, type Runtime, type RuntimeBranchResult } from '~/types'
import { type RunState } from '~/helpers/runner/runnerTypes'
import { EnqueueError } from '~/helpers/errors/EnqueueError'
import { createEvaluationRuntime } from '~/helpers/path/createEvaluationRuntime'
import { stopResult } from '~/helpers/runner/stopResult'

type RuntimeBranches = {
  executeThen(options?: { input?: unknown }): Promise<RuntimeBranchResult>
  executeCatch(): Promise<RuntimeBranchResult | undefined>
}

export const createRuntime = <TContext, TPatch>(
  state: RunState<TContext, TPatch>,
  branches: RuntimeBranches = {
    executeThen: async () => ({ status: 'success' }),
    executeCatch: async () => undefined,
  }
): Runtime => {
  const runtime = createEvaluationRuntime(state)
  const scheduler = state.scheduler
  const currentPool = state.pool
  const enqueue = scheduler
    ? async (entrypoint: string, input: Input, options: EnqueueOptions): Promise<void> => {
        if (currentPool !== undefined && currentPool === options.pool) {
          throw new EnqueueError(
            'ENQUEUE_SELF_POOL',
            `Run inside pool "${options.pool}" cannot enqueue into the same pool`
          )
        }
        await scheduler.enqueue({
          pool: options.pool,
          entrypoint,
          input,
          key: options.key ?? '',
          ...(options.coalesceToken === undefined ? {} : { coalesceToken: options.coalesceToken }),
        })
      }
    : undefined

  return {
    ...runtime,
    set: (path, value) => {
      if (state.closed === false) {
        set(state.context as Record<string, unknown>, path, value)
      }
    },
    setData: (path, value) => {
      console.warn('runtime.setData() is deprecated; use runtime.data.set() instead')
      runtime.data.set(path, value)
    },
    signal: state.signal,
    executeThen: async (options) =>
      state.closed ? { status: 'stopped', reason: 'Run is already finished' } : branches.executeThen(options),
    executeCatch: async () => (state.closed ? undefined : branches.executeCatch()),
    emit: (event) => {
      if (state.closed === false) {
        state.events.push(event)
      }
    },
    patch: (patch) => {
      if (state.closed === false) {
        state.patches.push(patch as TPatch)
      }
    },
    stop: (reason) => stopResult(reason),
    fail: (reason, failureData) => ({
      type: 'fail',
      ...(reason ? { reason } : {}),
      ...(failureData ? { data: failureData } : {}),
    }),
    ...(enqueue ? { enqueue } : {}),
  }
}
