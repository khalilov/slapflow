import { type SlapError } from '~/types'

export const slapError = (
  code: string,
  message: string,
  extras: Omit<SlapError, 'code' | 'message'> = {}
): SlapError => ({ code, message, ...extras })
