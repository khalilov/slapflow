import { parse } from 'objwalk'

export const parsePayload = (data: unknown): unknown => {
  if (typeof data === 'string') {
    return parse(data, { fallback: data })
  }

  return data
}
