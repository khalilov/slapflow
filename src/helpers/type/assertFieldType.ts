import { typeMismatchError } from '~/helpers/errors/typeMismatchError'
import { ResolutionError } from '~/helpers/path/ResolutionError'
import { describeValueType } from '~/helpers/type/describeValueType'
import { formatTypeDeclaration } from '~/helpers/type/formatTypeDeclaration'
import { matchesTypeDeclaration } from '~/helpers/type/matchesTypeDeclaration'
import { type EvaluationScope } from '~/types'

export const assertFieldType = (
  value: unknown,
  field: string | undefined,
  path: string,
  { types, strategy }: Pick<EvaluationScope<unknown>, 'types' | 'strategy'>
): unknown => {
  if (types !== undefined && field !== undefined && Object.hasOwn(types, field)) {
    const declaration = types[field]!

    if (matchesTypeDeclaration(value, declaration)) {
      return value
    }

    throw new ResolutionError(
      typeMismatchError(
        { path, expected: formatTypeDeclaration(declaration), received: describeValueType(value) },
        strategy
      )
    )
  }

  return value
}
