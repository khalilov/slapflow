import { slapError } from '~/helpers/errors/slapError'
import { type ExpressionDetails } from '~/helpers/path/expressionDetails'
import { ResolutionError } from '~/helpers/path/ResolutionError'

export const failExpression = (code: string, message: string, details: ExpressionDetails): never => {
  throw new ResolutionError(slapError(code, message, details))
}
