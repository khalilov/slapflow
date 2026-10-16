import { slapError } from '~/helpers/errors/slapError'
import { type SlapError } from '~/types'

export type TypeMismatch = {
  path: string
  expected: string
  received: string
}

export const typeMismatchError = ({ path, expected, received }: TypeMismatch, strategy?: string): SlapError =>
  slapError('TYPE_MISMATCH', `${path} expected ${expected}, received ${received}`, {
    path,
    ...(strategy === undefined ? {} : { strategy }),
  })
