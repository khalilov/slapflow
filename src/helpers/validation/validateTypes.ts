import { isRecord } from '~/helpers/type/isRecord'
import { isValidTypeDeclaration } from '~/helpers/validation/isValidTypeDeclaration'
import { type ValidationIssue } from '~/types'

const declarationIssue = (field: string, declaration: unknown): ValidationIssue | undefined => {
  if (isValidTypeDeclaration(declaration)) {
    return undefined
  }

  return {
    code: 'CONFIG_TYPES_INVALID',
    message: `Type declaration for "${field}" must be a variant or a non-empty flat array of variants`,
    path: `types.${field}`,
  }
}

export const validateTypes = (types: unknown, errors: ValidationIssue[]): void => {
  if (isRecord(types)) {
    for (const [field, declaration] of Object.entries(types)) {
      const issue = declarationIssue(field, declaration)

      if (issue !== undefined) {
        errors.push(issue)
      }
    }

    return
  }

  errors.push({
    code: 'CONFIG_TYPES_INVALID',
    message: 'Config types must be an object of field declarations',
    path: 'types',
  })
}
