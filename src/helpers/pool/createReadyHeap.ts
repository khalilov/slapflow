import { type ReadyHeap, type ReadyHeapEntry } from '~/types'

const compare = <T>(a: ReadyHeapEntry<T>, b: ReadyHeapEntry<T>): number => (a.at === b.at ? a.seq - b.seq : a.at - b.at)

export const createReadyHeap = <T>(): ReadyHeap<T> => {
  const entries: ReadyHeapEntry<T>[] = []

  const push = (entry: ReadyHeapEntry<T>): void => {
    let index = entries.length

    entries.push(entry)
    while (index > 0) {
      const parent = (index - 1) >> 1

      if (compare(entries[index] as ReadyHeapEntry<T>, entries[parent] as ReadyHeapEntry<T>) >= 0) {
        break
      }
      ;[entries[index], entries[parent]] = [entries[parent] as ReadyHeapEntry<T>, entries[index] as ReadyHeapEntry<T>]
      index = parent
    }
  }

  const pop = (): ReadyHeapEntry<T> | undefined => {
    const top = entries[0]
    const last = entries.pop()

    if (top === undefined || last === undefined) {
      return undefined
    }
    if (entries.length > 0) {
      let index = 0

      entries[0] = last
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index

        if (
          left < entries.length &&
          compare(entries[left] as ReadyHeapEntry<T>, entries[smallest] as ReadyHeapEntry<T>) < 0
        ) {
          smallest = left
        }
        if (
          right < entries.length &&
          compare(entries[right] as ReadyHeapEntry<T>, entries[smallest] as ReadyHeapEntry<T>) < 0
        ) {
          smallest = right
        }
        if (smallest === index) {
          break
        }
        ;[entries[index], entries[smallest]] = [
          entries[smallest] as ReadyHeapEntry<T>,
          entries[index] as ReadyHeapEntry<T>,
        ]
        index = smallest
      }
    }

    return top
  }

  return { size: () => entries.length, push, pop }
}
