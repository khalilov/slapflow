import { pick } from 'objwalk'
import { type ExpressionOperator } from '~/types'
import { slapError } from '~/helpers/errors/slapError'
import { type ExpressionDetails } from '~/helpers/path/expressionDetails'
import { failExpression } from '~/helpers/path/failExpression'
import { finiteNumbers } from '~/helpers/path/finiteNumbers'
import { propertyValue } from '~/helpers/path/propertyValue'
import { ResolutionError } from '~/helpers/path/ResolutionError'
import { protectedPickOptions } from '~/helpers/path/protectedPickOptions'

export const evaluateExpression = (
  operator: string,
  args: unknown[],
  custom: Record<string, ExpressionOperator>,
  details: ExpressionDetails
): unknown => {
  if (operator === 'add') {
    return finiteNumbers(operator, args, [2, Infinity], details).reduce((a, b) => a + b)
  }
  if (operator === 'subtract') {
    const numbers = finiteNumbers(operator, args, 2, details)
    const a = numbers[0] as number
    const b = numbers[1] as number

    return a - b
  }
  if (operator === 'multiply') {
    return finiteNumbers(operator, args, [2, Infinity], details).reduce((a, b) => a * b)
  }
  if (operator === 'divide' || operator === 'modulo') {
    const numbers = finiteNumbers(operator, args, 2, details)
    const a = numbers[0] as number
    const b = numbers[1] as number

    if (b === 0) {
      failExpression('EXPRESSION_DIVISION_BY_ZERO', `Expression "${operator}" cannot divide by zero`, details)
    }
    return operator === 'divide' ? a / b : a % b
  }
  if (operator === 'min' || operator === 'max') {
    return Math[operator](...finiteNumbers(operator, args, [1, Infinity], details))
  }
  if (['abs', 'round', 'floor', 'ceil'].includes(operator)) {
    const value = finiteNumbers(operator, args, 1, details)[0] as number
    return Math[operator as 'abs' | 'round' | 'floor' | 'ceil'](value)
  }
  if (operator === 'clamp') {
    const numbers = finiteNumbers(operator, args, 3, details)
    const value = numbers[0] as number
    const minimum = numbers[1] as number
    const maximum = numbers[2] as number

    if (minimum > maximum) {
      failExpression('EXPRESSION_INVALID_ARGUMENT', 'Expression "clamp" minimum exceeds maximum', details)
    }

    return Math.min(Math.max(value, minimum), maximum)
  }
  if (operator === 'at') {
    if (args.length !== 2) {
      failExpression('EXPRESSION_INVALID_ARGUMENT', 'Expression "at" requires two arguments', details)
    }
    const target = args[0]
    const index = args[1]

    if (!Array.isArray(target) || typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      failExpression(
        'EXPRESSION_INVALID_ARGUMENT',
        'Expression "at" requires an array and a non-negative integer',
        details
      )
    }
    const resolved = pick(target as unknown[], String(index), protectedPickOptions)

    if (resolved === undefined) {
      failExpression('EXPRESSION_PATH_NOT_FOUND', 'Expression array index was not found', details)
    }

    return resolved
  }
  if (operator === 'property') {
    if (args.length !== 2) {
      failExpression('EXPRESSION_INVALID_ARGUMENT', 'Expression "property" requires two arguments', details)
    }
    return propertyValue(args[0], args[1], details)
  }
  if (operator === 'get') {
    if (args.length !== 2 || typeof args[1] !== 'string') {
      failExpression('EXPRESSION_INVALID_ARGUMENT', 'Expression "get" requires an object and a path string', details)
    }
    const resolved = pick(args[0] as Record<string, unknown>, args[1] as string, protectedPickOptions)

    if (resolved === undefined) {
      return failExpression('EXPRESSION_PATH_NOT_FOUND', 'Expression path was not found', details)
    }
    return resolved
  }
  if (operator === 'concat') {
    if (args.some((value) => !['string', 'number', 'boolean', 'bigint'].includes(typeof value))) {
      failExpression(
        'EXPRESSION_INVALID_ARGUMENT',
        'Expression "concat" requires primitive string-compatible arguments',
        details
      )
    }
    return args.map(String).join('')
  }

  if (!Object.prototype.hasOwnProperty.call(custom, operator)) {
    failExpression('EXPRESSION_OPERATOR_NOT_FOUND', `Expression operator "${operator}" is not registered`, details)
  }
  const customOperator = custom[operator] as ExpressionOperator

  try {
    return customOperator(args)
  } catch (cause) {
    const causeType = cause instanceof Error ? 'Error' : typeof cause
    throw new ResolutionError(
      slapError('EXPRESSION_INVALID_ARGUMENT', `Expression operator "${operator}" rejected its arguments`, {
        ...details,
        cause: { type: causeType },
      })
    )
  }
}
