import { each } from 'objwalk'
import { type ValidationIssue } from '~/types'
import { isPathReference } from '~/helpers/path/isPathReference'
import { isValidPathReference } from '~/helpers/path/isValidPathReference'
import { parseTemplate } from '~/helpers/path/parseTemplate'
import { isString } from '~/helpers/type/isString'

export const validateRefs = (value: unknown, strategy: string, path: string, errors: ValidationIssue[]): void => {
  const report = (item: string, key: string | number | undefined, refPath: string): void => {
    if (key === '$template') {
      if (!parseTemplate(item).ok) {
        errors.push({ code: 'TEMPLATE_INVALID', message: 'Template syntax is invalid', strategy, path: refPath })
      }
      return
    }
    if (isPathReference(item) && !isValidPathReference(item)) {
      errors.push({ code: 'PATH_INVALID', message: `Invalid path reference "${item}"`, strategy, path: refPath })
    }
  }

  if (isString(value)) {
    report(value, undefined, path)
    return
  }
  each(value, (key, item, itemPath) => {
    if (isString(item)) {
      report(item, key, path ? `${path}.${itemPath}` : itemPath)
    }
  })
}
