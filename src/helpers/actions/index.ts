import { type Action } from '~/types'
import { coreDelay } from '~/helpers/actions/coreDelay'
import { coreEmit } from '~/helpers/actions/coreEmit'
import { coreFail } from '~/helpers/actions/coreFail'
import { coreFetch } from '~/helpers/actions/coreFetch'
import { coreLoop } from '~/helpers/actions/coreLoop'
import { coreNoop } from '~/helpers/actions/coreNoop'
import { corePatch } from '~/helpers/actions/corePatch'
import { coreSet } from '~/helpers/actions/coreSet'
import { coreSetData } from '~/helpers/actions/coreSetData'
import { coreStop } from '~/helpers/actions/coreStop'

export type ActionsRegistry<TContext, TPatch> = Map<string, Action<TContext, TPatch>>

export const BUILTIN_ACTIONS: readonly [name: string, action: Action<unknown, unknown>][] = [
  ['core.noop', coreNoop],
  ['core.stop', coreStop],
  ['core.fail', coreFail],
  ['core.fetch', coreFetch],
  ['core.loop', coreLoop],
  ['core.sequence', coreNoop],
  ['core.selector', coreNoop],
  ['core.parallel', coreNoop],
  ['core.set', coreSet],
  ['core.setData', coreSetData],
  ['core.emit', coreEmit],
  ['core.patch', corePatch],
  ['core.delay', coreDelay],
] as readonly [name: string, action: Action<unknown, unknown>][]

export const BUILTIN_ACTION_NAMES = new Set<string>(BUILTIN_ACTIONS.map(([name]) => name))
