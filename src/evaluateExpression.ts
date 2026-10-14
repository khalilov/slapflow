import { pick } from 'objwalk'
import { type EvaluationScope, type ExpressionEvaluationOptions, type ExpressionOutcome } from '~/types'
import { slapError } from '~/helpers/errors/slapError'
import { childPath } from '~/helpers/path/childPath'
import { failExpression } from '~/helpers/path/failExpression'
import { finiteNumbers } from '~/helpers/path/finiteNumbers'
import { propertyValue } from '~/helpers/path/propertyValue'
import { protectedPickOptions } from '~/helpers/path/protectedPickOptions'
import { ResolutionError } from '~/helpers/path/ResolutionError'
import { resolveValue } from '~/helpers/path/resolveValue'

export const evaluateExpression = <TContext>(
  expression: unknown,
  { context, input = {}, data = {}, variables = {}, strategy, configPath }: EvaluationScope<TContext>,
  { expressions = {} }: ExpressionEvaluationOptions = {}
): ExpressionOutcome => {
  const scope = { context, input, data, variables, expressions, ...(strategy === undefined ? {} : { strategy }) }
  const path = configPath ?? ''
  const details = { ...(strategy === undefined ? {} : { strategy }), path }

  try {
    if (Array.isArray(expression) && typeof expression[0] === 'string') {
      const [operator, ...rest] = expression
      const args = rest.map((argument, index) =>
        resolveValue(argument, scope, childPath(childPath(path, '$expression'), index + 1))
      )
      if (operator === 'add') {
        return { ok: true, value: finiteNumbers(operator, args, [2, Infinity], details).reduce((a, b) => a + b) }
      }
      if (operator === 'subtract') {
        const numbers = finiteNumbers(operator, args, 2, details)
        const [a, b] = numbers as [number, number]

        return { ok: true, value: a - b }
      }
      if (operator === 'multiply') {
        return { ok: true, value: finiteNumbers(operator, args, [2, Infinity], details).reduce((a, b) => a * b) }
      }
      if (operator === 'divide' || operator === 'modulo') {
        const numbers = finiteNumbers(operator, args, 2, details)
        const [a, b] = numbers as [number, number]

        if (b !== 0) {
          return { ok: true, value: operator === 'divide' ? a / b : a % b }
        }

        return failExpression('EXPRESSION_DIVISION_BY_ZERO', `Expression "${operator}" cannot divide by zero`, details)
      }
      if (operator === 'min' || operator === 'max') {
        return { ok: true, value: Math[operator](...finiteNumbers(operator, args, [1, Infinity], details)) }
      }
      if (operator === 'abs' || operator === 'round' || operator === 'floor' || operator === 'ceil') {
        const [value] = finiteNumbers(operator, args, 1, details) as [number]

        return { ok: true, value: Math[operator](value) }
      }
      if (operator === 'clamp') {
        const numbers = finiteNumbers(operator, args, 3, details)
        const [value, minimum, maximum] = numbers as [number, number, number]

        if (minimum <= maximum) {
          return { ok: true, value: Math.min(Math.max(value, minimum), maximum) }
        }

        return failExpression('EXPRESSION_INVALID_ARGUMENT', 'Expression "clamp" minimum exceeds maximum', details)
      }
      if (operator === 'at') {
        const [target, index] = args

        if (args.length === 2) {
          if (Array.isArray(target) && typeof index === 'number' && Number.isInteger(index) && index >= 0) {
            const resolved = pick(target, String(index), protectedPickOptions)

            if (resolved !== undefined) {
              return { ok: true, value: resolved }
            }

            return failExpression('EXPRESSION_PATH_NOT_FOUND', 'Expression array index was not found', details)
          }

          return failExpression(
            'EXPRESSION_INVALID_ARGUMENT',
            'Expression "at" requires an array and a non-negative integer',
            details
          )
        }

        return failExpression('EXPRESSION_INVALID_ARGUMENT', 'Expression "at" requires two arguments', details)
      }
      if (operator === 'property') {
        if (args.length === 2) {
          return { ok: true, value: propertyValue(args[0], args[1], details) }
        }

        return failExpression('EXPRESSION_INVALID_ARGUMENT', 'Expression "property" requires two arguments', details)
      }
      if (operator === 'get') {
        if (args.length === 2 && typeof args[1] === 'string') {
          const resolved = pick(args[0] as Record<string, unknown>, args[1], protectedPickOptions)

          if (resolved !== undefined) {
            return { ok: true, value: resolved }
          }

          return failExpression('EXPRESSION_PATH_NOT_FOUND', 'Expression path was not found', details)
        }

        return failExpression(
          'EXPRESSION_INVALID_ARGUMENT',
          'Expression "get" requires an object and a path string',
          details
        )
      }
      if (operator === 'concat') {
        if (args.every((value) => ['string', 'number', 'boolean', 'bigint'].includes(typeof value))) {
          return { ok: true, value: args.map(String).join('') }
        }

        return failExpression(
          'EXPRESSION_INVALID_ARGUMENT',
          'Expression "concat" requires primitive string-compatible arguments',
          details
        )
      }
      if (operator === 'coalesce') {
        if (args.length >= 1) {
          return { ok: true, value: args.find((value) => value !== null && value !== undefined) }
        }

        return failExpression(
          'EXPRESSION_INVALID_ARGUMENT',
          'Expression "coalesce" requires at least one argument',
          details
        )
      }
      if (Object.hasOwn(expressions, operator)) {
        const customOperator = expressions[operator]!

        try {
          return { ok: true, value: customOperator(args) }
        } catch (cause) {
          throw new ResolutionError(
            slapError('EXPRESSION_INVALID_ARGUMENT', `Expression operator "${operator}" rejected its arguments`, {
              ...details,
              cause: { type: cause instanceof Error ? 'Error' : typeof cause },
            })
          )
        }
      }

      return failExpression(
        'EXPRESSION_OPERATOR_NOT_FOUND',
        `Expression operator "${operator}" is not registered`,
        details
      )
    }

    return {
      ok: false,
      error: slapError('EXPRESSION_INVALID_ARGUMENT', 'Expression must contain an operator', details),
    }
  } catch (cause) {
    return {
      ok: false,
      error: slapError('EXPRESSION_INVALID_ARGUMENT', 'Expression evaluation failed', { from: cause, ...details }),
    }
  }
}
