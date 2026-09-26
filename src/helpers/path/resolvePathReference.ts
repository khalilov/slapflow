import { pick } from 'objwalk'
import { type ResolveScope } from '~/helpers/path/resolveScope'
import { createResolutionError } from '~/helpers/path/createResolutionError'
import { pathReferenceRegex } from '~/helpers/path/pathReferenceRegex'
import { protectedPickOptions } from '~/helpers/path/protectedPickOptions'

export const resolvePathReference = <TContext>(value: string, scope: ResolveScope<TContext>, path: string): unknown => {
  const match = value.match(pathReferenceRegex)

  if (match) {
    const root = match[1] as 'context' | 'data' | 'input' | 'variables'
    const nestedPath = match[2] ?? ''

    if (root === 'variables') {
      const source = scope.variables ?? {}

      if (nestedPath) {
        const resolved = pick(source, nestedPath, protectedPickOptions)

        if (resolved === undefined) {
          throw createResolutionError('VARIABLE_NOT_FOUND', 'Variable reference was not found', scope, path)
        }

        return resolved
      }

      return source
    }

    const source = scope[root]

    if (nestedPath) {
      if (source && typeof source === 'object') {
        return pick(source as Record<string, unknown>, nestedPath)
      }

      return undefined
    }

    return source
  }

  return value
}
