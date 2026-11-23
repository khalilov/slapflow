import { type RunOptions, type RunResult, type RunTraceEvent, type TraceOptions } from '~/types'
import { createId } from '~/helpers/ids/createId'
import { buildTimingTree } from '~/helpers/trace/buildTimingTree'

type RunTraceResult = Pick<RunResult<unknown>, 'status' | 'events' | 'timings'>

export const startRunTrace = (
  { callback = console.debug, level }: TraceOptions,
  entrypoint: string,
  { binding, pool }: RunOptions
): ((result: RunTraceResult) => void) => {
  const source = {
    runId: createId(),
    entrypoint,
    ...(binding === undefined ? {} : { binding }),
    ...(pool === undefined ? {} : { pool }),
  }
  const report = (event: RunTraceEvent): void => {
    try {
      callback(event)
    } catch {
      // Trace callbacks are observers and must preserve the run outcome.
    }
  }

  report({ ...source, type: 'run-start' })

  const startedAt = performance.now()

  return ({ status, events, timings }) => {
    const duration = performance.now() - startedAt
    const tree = level === 'tree' ? buildTimingTree(timings ?? []) : undefined

    report({
      ...source,
      type: 'run-end',
      status,
      duration,
      events: events.map(({ type }) => type),
      ...(tree === undefined ? {} : { tree }),
    })
  }
}
