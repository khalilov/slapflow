import { type ConditionFn } from '~/types'
import { BUILTIN_CONDITIONS } from '~/helpers/conditions'

export const createBuiltinConditions = <TContext>(): Record<string, ConditionFn<TContext>> =>
  Object.fromEntries(BUILTIN_CONDITIONS) as Record<string, ConditionFn<TContext>>
