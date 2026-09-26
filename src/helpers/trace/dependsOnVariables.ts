import { parseTemplate } from '~/helpers/path/parseTemplate'
import { isVariableRef } from '~/helpers/path/isVariableRef'
import { isRecord } from '~/helpers/type/isRecord'
import { isString } from '~/helpers/type/isString'

export const dependsOnVariables = (value: unknown): boolean => {
  if (isVariableRef(value)) {
    return true
  }
  if (Array.isArray(value)) {
    return value.some(dependsOnVariables)
  }
  if (isRecord(value)) {
    if (isString(value.$template)) {
      const parsed = parseTemplate(value.$template)

      return parsed.ok && parsed.parts.some((part) => part.type === 'variable')
    }

    return Object.values(value).some(dependsOnVariables)
  }

  return false
}
