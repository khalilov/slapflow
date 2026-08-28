import { type ConditionFn } from '~/types'
import { changedCondition } from '~/helpers/conditions/changedCondition'
import { cooldownReadyCondition } from '~/helpers/conditions/cooldownReadyCondition'
import { emptyCondition } from '~/helpers/conditions/emptyCondition'
import { eqCondition } from '~/helpers/conditions/eqCondition'
import { existsCondition } from '~/helpers/conditions/existsCondition'
import { falsyCondition } from '~/helpers/conditions/falsyCondition'
import { gtCondition } from '~/helpers/conditions/gtCondition'
import { gteCondition } from '~/helpers/conditions/gteCondition'
import { includesCondition } from '~/helpers/conditions/includesCondition'
import { ltCondition } from '~/helpers/conditions/ltCondition'
import { lteCondition } from '~/helpers/conditions/lteCondition'
import { missingCondition } from '~/helpers/conditions/missingCondition'
import { neqCondition } from '~/helpers/conditions/neqCondition'
import { notEmptyCondition } from '~/helpers/conditions/notEmptyCondition'
import { truthyCondition } from '~/helpers/conditions/truthyCondition'
import { typeIsCondition } from '~/helpers/conditions/typeIsCondition'

export type ConditionsRegistry<TContext> = Map<string, ConditionFn<TContext>>

export const createConditionsRegistry = <TContext>(): ConditionsRegistry<TContext> =>
  new Map<string, ConditionFn<TContext>>([
    ['eq', eqCondition],
    ['neq', neqCondition],
    ['gt', gtCondition],
    ['gte', gteCondition],
    ['lt', ltCondition],
    ['lte', lteCondition],
    ['truthy', truthyCondition],
    ['falsy', falsyCondition],
    ['exists', existsCondition],
    ['missing', missingCondition],
    ['empty', emptyCondition],
    ['notEmpty', notEmptyCondition],
    ['includes', includesCondition],
    ['typeIs', typeIsCondition],
    ['changed', changedCondition],
    ['cooldownReady', cooldownReadyCondition],
  ])
