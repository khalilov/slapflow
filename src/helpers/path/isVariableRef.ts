import { isString } from '~/helpers/type/isString'

export const isVariableRef = (value: unknown): value is string =>
  isString(value) && (value === '$variables' || value.startsWith('$variables.'))
