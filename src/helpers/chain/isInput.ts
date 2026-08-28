import { type Input } from '~/types'

export const isInput = (value: unknown): value is Input =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
