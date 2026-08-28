import { type SlapError } from '~/types'

export class ResolutionError extends Error {
  readonly slapError: SlapError

  constructor(slapError: SlapError) {
    super(slapError.message)
    this.name = 'ResolutionError'
    this.slapError = slapError
  }
}
