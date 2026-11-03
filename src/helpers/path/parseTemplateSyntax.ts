export type TemplatePart = Readonly<
  | { type: 'literal'; value: string }
  | { type: 'variable'; name: string; fallback?: string }
  | { type: 'data'; path: string }
>

export type ParseTemplateResult =
  { readonly ok: true; readonly parts: readonly TemplatePart[] } | { readonly ok: false }

const variablePattern = /^([A-Za-z_$][A-Za-z0-9_$]*)(?::-([^}]*))?$/
const dataPathPattern = /^[A-Za-z0-9_$.[\]-]+$/

export const parseTemplateSyntax = (template: string): ParseTemplateResult => {
  const parts: TemplatePart[] = []
  let literal = ''
  let offset = 0
  let valid = true

  const flushLiteral = (): void => {
    if (literal) {
      parts.push({ type: 'literal', value: literal })
      literal = ''
    }
  }

  while (valid && offset < template.length) {
    let readToken = true

    if (template[offset] === '\\') {
      let end = offset
      let slashCount: number
      let delimiter: string | undefined

      while (template[end] === '\\') {
        end += 1
      }
      slashCount = end - offset
      delimiter = template.startsWith('${', end) ? '${' : template.startsWith('{{', end) ? '{{' : undefined
      if (delimiter !== undefined) {
        literal += '\\'.repeat(Math.floor(slashCount / 2))
        if (slashCount % 2 === 1) {
          literal += delimiter
          offset = end + delimiter.length
          readToken = false
        } else {
          offset = end
        }
      } else {
        literal += '\\'.repeat(Math.ceil(slashCount / 2))
        offset = end
        readToken = false
      }
    }

    if (readToken) {
      if (template.startsWith('${', offset)) {
        const end = template.indexOf('}', offset + 2)
        const match = end >= 0 ? template.slice(offset + 2, end).match(variablePattern) : null

        if (match !== null) {
          flushLiteral()
          parts.push({
            type: 'variable',
            name: match[1] as string,
            ...(match[2] === undefined ? {} : { fallback: match[2] }),
          })
          offset = end + 1
        } else {
          valid = false
        }
      } else if (template.startsWith('{{', offset)) {
        const end = template.indexOf('}}', offset + 2)
        const path = end >= 0 ? template.slice(offset + 2, end).trim() : undefined

        if (path !== undefined && dataPathPattern.test(path)) {
          flushLiteral()
          parts.push({ type: 'data', path })
          offset = end + 2
        } else {
          valid = false
        }
      } else {
        literal += template[offset]
        offset += 1
      }
    }
  }

  if (valid) {
    if (literal || parts.length === 0) {
      parts.push({ type: 'literal', value: literal })
    }

    return { ok: true, parts }
  }

  return { ok: false }
}
