import { type ActionArgs, type ActionResult } from '~/types'
import { isRecord } from '~/helpers/type/isRecord'
import { stopResult } from '~/helpers/runner/stopResult'

export const coreInvoke = async <TContext, TPatch>({
  props,
  runtime,
}: ActionArgs<TContext>): Promise<ActionResult<TContext, TPatch>> => {
  const { items } = props

  if (!Array.isArray(items) && !isRecord(items)) {
    return runtime.fail('core.invoke requires "items" to be an array or object')
  }
  const values = Array.isArray(items) ? items : Object.values(items)

  for (const item of values) {
    const result = await runtime.executeThen({ input: item })

    if (result.status === 'stopped') {
      return stopResult<TPatch>(result.reason)
    }
  }

  return { continue: false }
}
