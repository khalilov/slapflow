export const parsePayload = (data: unknown): unknown => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  }

  return data
}
