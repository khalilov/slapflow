import { type EnqueueErrorCode, type SlapError } from '~/types'
import { slapError } from '~/helpers/errors/slapError'

export class EnqueueError extends Error {
  readonly slapError: SlapError

  constructor(code: EnqueueErrorCode, message: string) {
    super(message)
    this.name = 'EnqueueError'
    this.slapError = slapError(code, message)
  }
}
