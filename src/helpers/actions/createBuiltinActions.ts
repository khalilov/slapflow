import { type Action } from '~/types'
import { createActionsRegistry } from '~/registry/actions'

export const createBuiltinActions = <TContext, TPatch>(): Record<string, Action<TContext, TPatch>> =>
  Object.fromEntries(createActionsRegistry<TContext, TPatch>())
