import { matchesTypeVariant } from '~/helpers/type/matchesTypeVariant'
import { type TypeDeclaration } from '~/types'

export const matchesTypeDeclaration = (value: unknown, declaration: TypeDeclaration): boolean => {
  if (Array.isArray(declaration)) {
    return declaration.some((variant) => matchesTypeVariant(value, variant))
  }

  return matchesTypeVariant(value, declaration)
}
