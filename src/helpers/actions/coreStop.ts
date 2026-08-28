import { type ActionArgs, type ActionResult, type ActionStop } from '~/types'

export const coreStop = <TContext, TPatch>({
  props,
  runtime,
}: ActionArgs<TContext>): ActionResult<TContext, TPatch> =>
  runtime.stop(String(props.reason ?? 'stopped')) as ActionStop<TPatch>
