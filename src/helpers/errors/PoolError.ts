import { type SlapError } from '~/types'
import { slapError } from '~/helpers/errors/slapError'

export class PoolError extends Error {
  readonly slapError: SlapError

  constructor(code: 'POOL_NOT_FOUND', message: string) {
    super(message)
    this.name = 'PoolError'
    this.slapError = slapError(code, message)
  }
}
