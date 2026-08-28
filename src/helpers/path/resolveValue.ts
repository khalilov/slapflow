import { pick } from 'objwalk'
import { type ExpressionOperator, type Input, type Variables } from '~/types'
import { childPath } from '~/helpers/path/childPath'
import { createResolutionError } from '~/helpers/path/createResolutionError'
import { evaluateExpression } from '~/helpers/path/evaluateExpression'
import { pathReferenceRegex } from '~/helpers/path/pathReferenceRegex'
import { protectedPickOptions } from '~/helpers/path/protectedPickOptions'
import { parseTemplate } from '~/helpers/path/parseTemplate'

export type ResolveScope<TContext> = {
  context: TContext
  data: Record<string, unknown>
  input: Input
  variables?: Variables
  expressions?: Record<string, ExpressionOperator>
  strategy?: string
  configPath?: string
}

export const resolveValue = <TContext>(
  value: unknown,
  scope: ResolveScope<TContext>,
  path = scope.configPath ?? ''
): unknown => {
  if (typeof value === 'string') {
    const match = value.match(pathReferenceRegex)
    if (!match) {
      return value
    }
    const root = match[1] as 'context' | 'data' | 'input' | 'variables'
    const nestedPath = match[2] ?? ''

    if (root !== 'variables') {
      const source = scope[root]
      if (!nestedPath) {
        return source
      }
      if (!source || typeof source !== 'object') {
        return undefined
      }
      return pick(source as Record<string, unknown>, nestedPath)
    }

    const source = scope.variables ?? {}

    if (!nestedPath) {
      return source
    }
    const resolved = pick(source, nestedPath, protectedPickOptions)
    if (resolved === undefined) {
      throw createResolutionError('VARIABLE_NOT_FOUND', 'Variable reference was not found', scope, path)
    }
    return resolved
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => resolveValue(item, scope, childPath(path, index)))
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>

    if (Object.prototype.hasOwnProperty.call(record, '$expression')) {
      if (!Array.isArray(record.$expression) || typeof record.$expression[0] !== 'string') {
        throw createResolutionError('EXPRESSION_INVALID_ARGUMENT', 'Expression must contain an operator', scope, path)
      }
      const [operator, ...rawArgs] = record.$expression
      const args = rawArgs.map((argument, index) =>
        resolveValue(argument, scope, childPath(childPath(path, '$expression'), index + 1))
      )

      return evaluateExpression(operator, args, scope.expressions ?? {}, {
        ...(scope.strategy ? { strategy: scope.strategy } : {}),
        path,
      })
    }
    if (typeof record.$template === 'string') {
      const parsed = parseTemplate(record.$template)

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
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, resolveValue(item, scope, childPath(path, key))])
    )
  }

  return value
}
