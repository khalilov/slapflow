import { type TypeDeclaration } from '~/types'

export const formatTypeDeclaration = (declaration: TypeDeclaration): string => {
  const variants = Array.isArray(declaration) ? declaration : [declaration]

  return variants.map((variant) => variant ?? 'null').join(' | ')
}
