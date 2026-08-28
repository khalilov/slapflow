import { type ActionArgs, type ActionResult } from '~/types'

export const coreEmit = <TContext, TPatch>({
  props,
  runtime,
}: ActionArgs<TContext>): ActionResult<TContext, TPatch> => {
  const type = props.type

  if (typeof type === 'string') {
    runtime.emit({ type, payload: props.payload })
  }
}
