import { type ActionResult } from '~/types'

export const coreNoop = <TContext, TPatch>(): ActionResult<TContext, TPatch> => undefined
