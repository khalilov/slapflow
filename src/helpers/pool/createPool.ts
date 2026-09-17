import { type Pool, type PoolDefinition } from '~/types'
import { createReadyHeap } from '~/helpers/pool/createReadyHeap'

export const createPool = (definition: PoolDefinition): Pool => ({
  ...definition,
  lines: new Map(),
  ready: createReadyHeap(),
  active: 0,
  queued: 0,
  seq: 0,
  waiters: [],
})
