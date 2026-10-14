import { type SlapError } from '~/types'
import { ResolutionError } from '~/helpers/path/ResolutionError'

type SlapErrorOptions = Omit<SlapError, 'code' | 'message'> & { from?: unknown }

export const slapError = (code: string, message: string, extras: SlapErrorOptions = {}): SlapError => {
  const { from, ...details } = extras

  if (Object.hasOwn(extras, 'from')) {
    if (from instanceof ResolutionError) {
      return from.slapError
    }

    return { code, message, ...details, cause: { type: from instanceof Error ? 'Error' : typeof from } }
  }

  return { code, message, ...details }
}
