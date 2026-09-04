import { type ActionArgs, type ActionResult } from '~/types'

export const coreFail = <TContext, TPatch>({ props, runtime }: ActionArgs<TContext>): ActionResult<TContext, TPatch> =>
  runtime.fail(String(props.reason ?? 'failed'), props.data as Record<string, unknown> | undefined)
