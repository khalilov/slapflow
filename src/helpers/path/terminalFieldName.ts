const fieldNameRegex = /^(?!\d+$)[A-Za-z0-9_$-]+$/

export const terminalFieldName = (nestedPath: string): string | undefined => {
  const segment = nestedPath.slice(nestedPath.lastIndexOf('.') + 1)

  if (fieldNameRegex.test(segment)) {
    return segment
  }

  return undefined
}
