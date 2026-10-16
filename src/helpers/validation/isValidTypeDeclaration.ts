const typeVariants = new Set<string>(['string', 'number', 'boolean', 'undefined'])

export const isValidTypeDeclaration = (declaration: unknown): boolean => {
  const variants: unknown[] = Array.isArray(declaration) ? [...declaration] : [declaration]

  return (
    variants.length > 0 &&
    variants.every((variant) => variant === null || (typeof variant === 'string' && typeVariants.has(variant)))
  )
}
