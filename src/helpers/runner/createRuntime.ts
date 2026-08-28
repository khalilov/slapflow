import { pick, set } from 'objwalk'
import { type Runtime, type RuntimeBranchResult } from '~/types'
import { type RunState } from '~/helpers/runner/runnerTypes'
import { resolveValue } from '~/helpers/path/resolveValue'
import { stopResult } from '~/helpers/runner/stopResult'
import { protectedPickOptions } from '~/helpers/path/protectedPickOptions'

type RuntimeBranches = {
  executeThen(): Promise<RuntimeBranchResult>
  executeCatch(): Promise<RuntimeBranchResult | undefined>
}

export const createRuntime = <TContext, TPatch>(
  state: RunState<TContext, TPatch>,
  branches: RuntimeBranches = {
    executeThen: async () => ({ status: 'success' }),
    executeCatch: async () => undefined,
  }
): Runtime => {
  const data = {
    get: (path: string) => pick(state.data, path),
    set: (path: string, value: unknown) => {
      if (!state.closed) {
        set(state.data, path, value)
      }
    },
  }

  return {
    get: (path) => pick(state.context as Record<string, unknown>, path),
    set: (path, value) => {
      if (!state.closed) {
        set(state.context as Record<string, unknown>, path, value)
      }
    },
    data,
    variables: {
      get: (path: string) => pick(state.variables, path, protectedPickOptions),
    },
    getData: (path) => {
      console.warn('runtime.getData() is deprecated; use runtime.data.get() instead')
      return data.get(path)
    },
    setData: (path, value) => {
      console.warn('runtime.setData() is deprecated; use runtime.data.set() instead')
      data.set(path, value)
    },
    resolve: (value) => resolveValue(value, state),
    signal: state.signal,
    executeThen: async () =>
      state.closed ? { status: 'stopped', reason: 'Run is already finished' } : branches.executeThen(),
    executeCatch: async () => (state.closed ? undefined : branches.executeCatch()),
    emit: (event) => {
      if (!state.closed) {
        state.events.push(event)
      }
    },
    patch: (patch) => {
      if (!state.closed) {
        state.patches.push(patch as TPatch)
      }
    },
    stop: (reason) => stopResult(reason),
    fail: (reason, failureData) => ({
      type: 'fail',
      ...(reason ? { reason } : {}),
      ...(failureData ? { data: failureData } : {}),
    }),
  }
}
