import { slapError } from '~/helpers/errors/slapError'
import { type ResolveScope } from '~/helpers/path/resolveValue'
import { ResolutionError } from '~/helpers/path/ResolutionError'

export const createResolutionError = (
  code: string,
  message: string,
  scope: ResolveScope<unknown>,
  path: string
): ResolutionError =>
  new ResolutionError(
    slapError(code, message, {
      ...(scope.strategy ? { strategy: scope.strategy } : {}),
      path,
    })
  )
