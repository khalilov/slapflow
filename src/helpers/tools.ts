import { clone, diff, each, equally, extract, flush, map, merge, parse, pick, set, stringify } from 'objwalk'

export const tools = Object.freeze({
  clone,
  diff,
  each,
  equally,
  extract,
  flush,
  map,
  merge,
  parse,
  pick,
  set,
  stringify,
})

export type Tools = typeof tools
