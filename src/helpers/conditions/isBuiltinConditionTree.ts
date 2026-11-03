import { BUILTIN_CONDITIONS } from '~/helpers/conditions'

const builtinNames = new Set(BUILTIN_CONDITIONS.map(([name]) => name))
const classifications = new WeakMap<object, boolean>()

// Only runner-owned config snapshots are classified; custom handlers keep the full runtime.
export const isBuiltinConditionTree = (expression: unknown): boolean => {
  if (Array.isArray(expression)) {
    const cached = classifications.get(expression)

    if (cached === undefined) {
      const [operator, ...args] = expression
      let builtin = builtinNames.has(operator)

      classifications.set(expression, false)
      if (operator === 'and' || operator === 'or') {
        builtin = args.every(isBuiltinConditionTree)
      } else if (operator === 'not' || operator === 'ensure') {
        builtin = args.length === 1 && isBuiltinConditionTree(args[0])
      }
      classifications.set(expression, builtin)

      return builtin
    }

    return cached
  }

  return typeof expression === 'boolean' || expression === undefined
}
