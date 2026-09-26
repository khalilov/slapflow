import { pick } from 'objwalk'
import { type ResolveScope } from '~/helpers/path/resolveScope'
import { createResolutionError } from '~/helpers/path/createResolutionError'
import { parseTemplate } from '~/helpers/path/parseTemplate'
import { protectedPickOptions } from '~/helpers/path/protectedPickOptions'

export const resolveTemplateValue = <TContext>(
  template: string,
  scope: ResolveScope<TContext>,
  path: string
): string => {
  const parsed = parseTemplate(template)

  if (!parsed.ok) {
    throw createResolutionError('TEMPLATE_INVALID', 'Template syntax is invalid', scope, path)
  }

  return parsed.parts
    .map((part) => {
      if (part.type === 'literal') {
        return part.value
      }
      if (part.type === 'data') {
        const scopedPath = part.path.match(/^(context|data|input)\.(.+)$/)
        const source = scopedPath ? scope[scopedPath[1] as 'context' | 'data' | 'input'] : scope.data
        const resolved = pick(source as Record<string, unknown>, scopedPath?.[2] ?? part.path)

        return resolved == null ? '' : String(resolved)
      }
      const resolved = pick(scope.variables ?? {}, part.name, protectedPickOptions)

      if (resolved === undefined || resolved === null || (part.fallback !== undefined && resolved === '')) {
        if (part.fallback !== undefined) {
          return part.fallback
        }
        throw createResolutionError('VARIABLE_NOT_FOUND', 'Template variable was not found', scope, path)
      }

      return String(resolved)
    })
    .join('')
}
