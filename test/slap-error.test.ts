import { strict } from 'node:assert'
import { describe, it } from 'vitest'
import { slapError } from '~/helpers/errors/slapError'
import { ResolutionError } from '~/helpers/path/ResolutionError'

describe('slapError', () => {
  it('preserves existing extras and raw causes', () => {
    const cause = new Error('original')
    const extras = { cause, strategy: 'root', path: 'when[1]' }

    strict.deepEqual(slapError('ACTION_THROWN', 'Action failed', extras), {
      code: 'ACTION_THROWN',
      message: 'Action failed',
      ...extras,
    })
    strict.equal(slapError('ACTION_THROWN', 'Action failed', extras).cause, cause)
    strict.deepEqual(slapError('CONFIG_INVALID', 'Missing config'), {
      code: 'CONFIG_INVALID',
      message: 'Missing config',
    })
  })

  it('preserves an existing resolution error including its identity and details', () => {
    const error = slapError('VARIABLE_NOT_FOUND', 'Missing variable', { path: 'when[1]' })
    const from = new ResolutionError(error)

    strict.equal(slapError('CONDITION_THROWN', 'Condition failed', { from }), error)
  })

  it.each([
    { from: new Error('private message'), type: 'Error' },
    { from: 'private message', type: 'string' },
    { from: undefined, type: 'undefined' },
    { from: null, type: 'object' },
  ])('normalizes caught $type without including its value', ({ from, type }) => {
    const error = slapError('CONDITION_THROWN', 'Condition failed', { from, path: 'when' })

    strict.deepEqual(error, {
      code: 'CONDITION_THROWN',
      message: 'Condition failed',
      path: 'when',
      cause: { type },
    })
  })
})
