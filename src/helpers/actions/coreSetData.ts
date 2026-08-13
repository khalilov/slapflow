import { type BehaviorActionArgs, type BehaviorActionResult } from '~/types'

/** @deprecated Use `runtime.data.set(path, value)` inside an application action. */
export const coreSetData = <TContext, TPatch>({
  props,
  runtime,
}: BehaviorActionArgs<TContext>): BehaviorActionResult<TContext, TPatch> => {
  const path = props.path

  if (typeof path === 'string') {
    runtime.data.set(path, props.value)
  }
  return props.data ? { data: props.data as Record<string, unknown> } : undefined
}
