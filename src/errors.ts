import { type SlapError } from '~/types'

export { slapError } from '~/helpers/errors/slapError'
export { defineErrorReporter } from '~/helpers/errors/defineErrorReporter'

export class SyncAsyncError extends Error {
  readonly slapError: SlapError

  constructor(error: SlapError) {
    super(error.message)
    this.name = 'SyncAsyncError'
    this.slapError = error
  }
}
