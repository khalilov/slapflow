import { type TraceEntry, type TraceSink } from '~/types'

export const createMemoryTraceSink = (): TraceSink => {
  const items: TraceEntry[] = []
  return {
    push: (entry) => {
      items.push(entry)
    },
    entries: () => [...items],
  }
}
