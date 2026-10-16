import { type TypeVariant } from '~/types'

export const matchesTypeVariant = (value: unknown, variant: TypeVariant): boolean => {
  if (variant === null) {
    return value === null
  }
  if (variant === 'undefined') {
    return value === undefined
  }

  return typeof value === variant
}
