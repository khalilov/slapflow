import { type Variables } from '~/types'
import { cloneRuntimeVariableValue } from '~/helpers/runner/cloneRuntimeVariableValue'

export const cloneRuntimeVariables = (variables: Variables, seen = new WeakMap<object, unknown>()): Variables =>
  cloneRuntimeVariableValue(variables, seen) as Variables
