import { type ActionArgs, type ActionResult } from '~/types'

export const corePatch = <TContext, TPatch>({
  props,
  runtime,
}: ActionArgs<TContext>): ActionResult<TContext, TPatch> => {
  if ('patch' in props) {
    runtime.patch(props.patch)
  }
}
