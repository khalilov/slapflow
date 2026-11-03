import { type Normalized } from '~/helpers/runner/runnerTypes'

export const successResult = <TContext, TPatch>(): Normalized<TContext, TPatch> => ({
  status: 'success',
})
