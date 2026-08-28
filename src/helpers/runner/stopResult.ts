import { type ActionStop } from '~/types'

export const stopResult = <TPatch>(reason?: string): ActionStop<TPatch> =>
  reason ? { type: 'stop', reason } : { type: 'stop' }
