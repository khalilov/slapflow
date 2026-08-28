import { type ConditionFn } from '~/types'
import { createConditionsRegistry } from '~/registry/conditions'

export const createBuiltinConditions = <TContext>(): Record<string, ConditionFn<TContext>> =>
  Object.fromEntries(createConditionsRegistry<TContext>())
