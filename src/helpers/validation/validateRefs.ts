import { type ValidationIssue } from '~/types'
import { isPathReference } from '~/helpers/path/isPathReference'
import { isValidPathReference } from '~/helpers/path/isValidPathReference'
import { parseTemplate } from '~/helpers/path/parseTemplate'

export const validateRefs = (value: unknown, strategy: string, path: string, errors: ValidationIssue[]): void => {
  if (typeof value === 'string') {
    if (isPathReference(value) && !isValidPathReference(value)) {
      errors.push({ code: 'PATH_INVALID', message: `Invalid path reference "${value}"`, strategy, path })
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateRefs(item, strategy, `${path}.${index}`, errors))
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (key === '$template' && typeof item === 'string') {
        if (!parseTemplate(item).ok) {
          errors.push({
            code: 'TEMPLATE_INVALID',
            message: 'Template syntax is invalid',
            strategy,
            path: `${path}.${key}`,
          })
        }
      } else {
        validateRefs(item, strategy, `${path}.${key}`, errors)
      }
    })
  }
}
