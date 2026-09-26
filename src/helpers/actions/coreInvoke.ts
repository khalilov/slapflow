import { type ActionArgs, type ActionResult, type RunResult } from '~/types'
import { isRecord } from '~/helpers/type/isRecord'

export const coreInvoke = <TContext, TPatch>({
  props,
  runtime,
}: ActionArgs<TContext>): ActionResult<TContext, TPatch> | Promise<ActionResult<TContext, TPatch>> => {
  const { entrypoint, input } = props

  if (typeof entrypoint !== 'string' || entrypoint.length === 0) {
    return runtime.fail('core.invoke requires a non-empty "entrypoint" prop')
  }
  if (!runtime.invoke) {
    return runtime.fail('core.invoke is unavailable without a runner')
  }
  if (input !== undefined && !isRecord(input)) {
    return runtime.fail('core.invoke "input" prop must be an object')
  }
  const pending = runtime.invoke(entrypoint, input ?? {})

  if (!runtime.hasThen && !runtime.hasCatch) {
    void pending.catch(() => undefined)
    return
  }

  return pending.then((result: RunResult<unknown, unknown>): ActionResult<TContext, TPatch> => {
    if (result.status === 'failed') {
      return { type: 'fail', error: result.error, data: result.data }
    }
    if (result.status === 'skipped') {
      return { type: 'skip', data: result.data }
    }
    if (result.status === 'stopped') {
      return { type: 'stop' }
    }
    return { type: 'success', data: result.data, patch: result.patches as TPatch[], events: result.events }
  })
}
