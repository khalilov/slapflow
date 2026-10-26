import { each } from 'objwalk'
import { type Config, type ValidationIssue, type ValidationResult } from '~/types'
import { detectCycles } from '~/helpers/validation/detectCycles'
import { detectNestedLoops } from '~/helpers/validation/detectNestedLoops'
import { validateCondition } from '~/helpers/validation/validateCondition'
import { validateNextList } from '~/helpers/validation/validateNextList'
import { validateRefs } from '~/helpers/validation/validateRefs'
import { validateTypes } from '~/helpers/validation/validateTypes'
import { resolveGuards } from '~/helpers/validation/resolveGuards'
import { validModes } from '~/helpers/validation/validationConstants'
import { type RegistryReader } from '~/helpers/validation/registryReader'

export const validateConfig = (
  config: Config | undefined,
  actionsRegistry: RegistryReader,
  conditionsRegistry: RegistryReader
): ValidationResult => {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  if (config !== null && config !== undefined && typeof config === 'object') {
    const { strategies } = config

    if (strategies !== null && typeof strategies === 'object' && Array.isArray(strategies) === false) {
      const guardResolution = resolveGuards(config)

      if (config.guards !== undefined) {
        if (config.guards === null || typeof config.guards !== 'object' || Array.isArray(config.guards)) {
          errors.push({ code: 'GUARD_INVALID', message: 'Config guards must be an object', path: 'guards' })
        } else {
          each(
            config.guards,
            (name, expression) => {
              validateCondition(expression, name, `guards.${name}`, conditionsRegistry, errors, { allowEnsure: true })
            },
            { shallow: true }
          )
        }
      }

      if (config.types !== undefined) {
        validateTypes(config.types, errors)
      }

      for (const issue of guardResolution.issues) {
        errors.push({
          code: issue.code,
          message: issue.message,
          ...(issue.path ? { path: issue.path } : {}),
        })
      }

      each(
        config.strategies,
        (id, strategy) => {
          if (strategy && typeof strategy === 'object') {
            const resolvedWhen = guardResolution.config.strategies[id]?.when

            if (!strategy.fn || typeof strategy.fn !== 'string') {
              errors.push({ code: 'FN_MISSING', message: 'Strategy fn is required', strategy: id, path: `${id}.fn` })
            } else if (!actionsRegistry.has(strategy.fn)) {
              errors.push({
                code: 'ACTION_NOT_FOUND',
                message: `Action "${strategy.fn}" is not registered`,
                strategy: id,
                path: `${id}.fn`,
              })
            }
            if (strategy.mode && !validModes.has(strategy.mode)) {
              errors.push({ code: 'MODE_INVALID', message: `Mode "${strategy.mode}" is invalid`, strategy: id })
            }
            validateNextList(config, strategy.then, `${id}.then`, id, conditionsRegistry, errors)
            validateNextList(config, strategy.catch, `${id}.catch`, id, conditionsRegistry, errors)
            validateCondition(strategy.when, id, `${id}.when`, conditionsRegistry, errors, { allowEnsure: true })
            validateRefs(strategy.props, id, `${id}.props`, errors)
            if (Array.isArray(resolvedWhen) && resolvedWhen[0] === 'ensure' && !strategy.catch?.length) {
              errors.push({
                code: 'ENSURE_WITHOUT_CATCH',
                message: 'Strategy with a root ensure condition must define catch',
                strategy: id,
                path: `${id}.when`,
              })
            }
          } else {
            errors.push({ code: 'STRATEGY_INVALID', message: 'Strategy must be an object', strategy: id })
          }
        },
        { shallow: true }
      )

      each(
        config.entrypoints ?? {},
        (name, target) => {
          if (!config.strategies[target]) {
            errors.push({
              code: 'STRATEGY_NOT_FOUND',
              message: `Entrypoint "${name}" references missing strategy "${target}"`,
              path: `entrypoints.${name}`,
            })
          }
        },
        { shallow: true }
      )

      detectCycles(config, errors, warnings)
      detectNestedLoops(config, errors)
      return { ok: errors.length === 0, errors, warnings }
    }
    return {
      ok: false,
      errors: [{ code: 'CONFIG_INVALID', message: 'Config must include a strategies object', path: 'strategies' }],
      warnings,
    }
  }
  return {
    ok: false,
    errors: [{ code: 'CONFIG_INVALID', message: 'Config must be an object' }],
    warnings,
  }
}
