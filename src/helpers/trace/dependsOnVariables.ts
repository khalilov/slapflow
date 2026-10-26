import { each } from 'objwalk'
import { parseTemplate } from '~/helpers/path/parseTemplate'
import { isVariableRef } from '~/helpers/path/isVariableRef'
import { isRecord } from '~/helpers/type/isRecord'
import { isString } from '~/helpers/type/isString'

export const dependsOnVariables = (value: unknown): boolean => {
  let found = false

  each(
    value,
    (_key, item: unknown) => {
      if (isVariableRef(item)) {
        found = true
      } else if (isRecord(item) && isString(item.$template)) {
        const parsed = parseTemplate(item.$template)

        found = parsed.ok && parsed.parts.some((part) => part.type === 'variable')
      }
      return found === false
    },
    {
      root: true,
      descend: ({ value }) => Array.isArray(value) || (isRecord(value) && isString(value.$template) === false),
    }
  )
  return found
}
