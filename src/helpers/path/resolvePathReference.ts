import { pick } from 'objwalk'
import { type ResolveScope } from '~/helpers/path/resolveScope'
import { terminalFieldName } from '~/helpers/path/terminalFieldName'
import { assertFieldType } from '~/helpers/type/assertFieldType'
import { createResolutionError } from '~/helpers/path/createResolutionError'
import { pathReferenceRegex } from '~/helpers/path/pathReferenceRegex'
import { protectedPickOptions } from '~/helpers/path/protectedPickOptions'

type PathReference = {
  root: 'context' | 'data' | 'input' | 'variables'
  nestedPath: string
  terminalFieldName: string | undefined
}

const references = new Map<string, PathReference | null>()
const referenceLimit = 1_024

export const resolvePathReference = <TContext>(value: string, scope: ResolveScope<TContext>, path: string): unknown => {
  let reference = references.get(value)

  if (reference === undefined) {
    const match = value.match(pathReferenceRegex)
    const nestedPath = match?.[2] ?? ''
    const oldest = references.keys().next()

    reference = match
      ? { root: match[1] as PathReference['root'], nestedPath, terminalFieldName: terminalFieldName(nestedPath) }
      : null
    if (references.size >= referenceLimit && oldest.done === false) {
      references.delete(oldest.value)
    }
    references.set(value, reference)
  }

  if (reference !== null) {
    const { root, nestedPath } = reference

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
      const resolved =
        source && typeof source === 'object' ? pick(source as Record<string, unknown>, nestedPath) : undefined

      return scope.types !== undefined && (root === 'context' || root === 'input')
        ? assertFieldType(resolved, reference.terminalFieldName, `${root}.${nestedPath}`, scope)
        : resolved
    }

    return source
  }

  return value
}
