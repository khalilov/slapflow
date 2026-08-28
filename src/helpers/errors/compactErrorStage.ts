import { type ErrorStage } from '~/types'

export const compactErrorStage = (stage: ErrorStage): ErrorStage =>
  Object.fromEntries(Object.entries(stage).filter(([, value]) => value !== undefined)) as ErrorStage
