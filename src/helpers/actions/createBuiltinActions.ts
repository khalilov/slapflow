import { type Action } from '~/types'
import { BUILTIN_ACTIONS } from '~/helpers/actions'

export const createBuiltinActions = <TContext, TPatch>(): Record<string, Action<TContext, TPatch>> =>
  Object.fromEntries(BUILTIN_ACTIONS) as Record<string, Action<TContext, TPatch>>
