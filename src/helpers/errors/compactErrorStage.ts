import { each, flush } from 'objwalk'
import { type ErrorStage } from '~/types'

export const compactErrorStage = (stage: ErrorStage): ErrorStage => {
  const result = { ...stage }

  each(
    stage,
    (key, value) => {
      if (value === undefined) {
        flush(result, key)
      }
    },
    { shallow: true }
  )
  return result
}
