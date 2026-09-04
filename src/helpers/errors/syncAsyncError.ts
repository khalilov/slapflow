import { type SlapError } from '~/types'

export class SyncAsyncError extends Error {
  readonly slapError: SlapError

  constructor(error: SlapError) {
    super(error.message)
    this.name = 'SyncAsyncError'
    this.slapError = error
  }
}
