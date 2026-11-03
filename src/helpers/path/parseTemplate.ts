import { parseTemplateSyntax, type ParseTemplateResult } from '~/helpers/path/parseTemplateSyntax'

const templates = new Map<string, ParseTemplateResult>()
const templateLimit = 1_024

export const parseTemplate = (template: string): ParseTemplateResult => {
  let parsed = templates.get(template)

  if (parsed === undefined) {
    parsed = parseTemplateSyntax(template)
    if (parsed.ok) {
      for (const part of parsed.parts) {
        Object.freeze(part)
      }
      Object.freeze(parsed.parts)
    }
    Object.freeze(parsed)
    if (templates.size >= templateLimit) {
      const oldest = templates.keys().next()

      if (oldest.done === false) {
        templates.delete(oldest.value)
      }
    }
    templates.set(template, parsed)
  }

  return parsed
}
