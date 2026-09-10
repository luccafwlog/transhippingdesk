// Fronteira numérica dos imports (S03 P0-1): parse explícito por formato
// declarado, sem remover letras nem inferir separador. Formato ausente nunca
// adivinha: devolve `ambiguous`. Devolve string decimal canônica (sem float)
// para o caller converter após validar precisão/faixa e regras de domínio.
export type ParsedNumber =
  | { kind: 'value'; decimal: string }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: 'syntax' | 'ambiguous' | 'non_finite' }

export type ImportNumberFormat = 'pt-BR' | 'en-US' | 'unknown'

export type ParseImportNumberOptions = {
  format?: ImportNumberFormat
  /** Desligado por padrão: `1e3` é sintaxe inválida, nunca 13 nem 1000. */
  allowExponent?: boolean
}

const NON_FINITE_PATTERN = /^[+-]?(inf(inity)?|nan)$/i
const EXPONENT_PATTERN = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))[eE]([+-]?\d+)$/
const PT_BR_PATTERN = /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/
const EN_US_PATTERN = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/
const GROUP_BODY = /^\d{1,3}$/
// ponytail: teto 1000 evita '0'.repeat() gigante em planilha hostil;
// expoente real de import cabe folgado aqui.
const MAX_EXPONENT = 1000

function normalizeZero(decimal: string): string {
  if (!decimal.startsWith('-')) return decimal
  return Number(decimal) === 0 ? '0' : decimal
}

function applyExponent(coefficient: string, exponent: number): string {
  const sign = coefficient.startsWith('-') ? '-' : ''
  const unsigned = coefficient.replace(/^[+-]/, '')
  const [intPart = '', fracPart = ''] = unsigned.split('.')
  const combined = intPart + fracPart
  const digits = combined.replace(/^0+/, '')
  if (!digits) return '0'
  const pointPos = intPart.length + exponent - (combined.length - digits.length)
  let result: string
  if (pointPos <= 0) result = `0.${'0'.repeat(-pointPos)}${digits}`
  else if (pointPos >= digits.length) result = digits + '0'.repeat(pointPos - digits.length)
  else result = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`
  if (result.includes('.')) result = result.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return normalizeZero(sign + result)
}

function canonicalize(unsigned: string, grouping: '.' | ',', decimalSep: '.' | ','): string {
  return unsigned.split(grouping).join('').split(decimalSep).join('.')
}

function splitSign(text: string): { sign: string; unsigned: string } {
  return text.startsWith('+') || text.startsWith('-')
    ? { sign: text[0] === '-' ? '-' : '', unsigned: text.slice(1) }
    : { sign: '', unsigned: text }
}

function parseBothSeparators(unsigned: string): ParsedNumber {
  const lastDot = unsigned.lastIndexOf('.')
  const lastComma = unsigned.lastIndexOf(',')
  const decimalSep = lastDot > lastComma ? '.' : ','
  const grouping: '.' | ',' = decimalSep === '.' ? ',' : '.'
  const cut = decimalSep === '.' ? lastDot : lastComma
  const intPart = unsigned.slice(0, cut)
  const fracPart = unsigned.slice(cut + 1)
  const groupingPattern = grouping === '.' ? /^\d{1,3}(?:\.\d{3})*$/ : /^\d{1,3}(?:,\d{3})*$/
  if (!intPart || !/^\d+$/.test(fracPart) || !groupingPattern.test(intPart)) {
    return { kind: 'invalid', reason: 'syntax' }
  }
  return { kind: 'value', decimal: canonicalize(unsigned, grouping, decimalSep) }
}

function parseSingleSeparator(sign: string, unsigned: string, sep: '.' | ','): ParsedNumber {
  const parts = unsigned.split(sep)
  if (parts.length === 2 && parts[0] !== '' && /^\d+$/.test(parts[0])) {
    if (parts[1].length === 3 && /^\d{3}$/.test(parts[1])) {
      return { kind: 'invalid', reason: 'ambiguous' }
    }
    if (/^\d+$/.test(parts[1])) {
      return { kind: 'value', decimal: normalizeZero(`${sign}${parts[0]}.${parts[1]}`) }
    }
    return { kind: 'invalid', reason: 'syntax' }
  }
  // Vários separadores só podem ser agrupamento (dois decimais é impossível).
  const grouped = parts.length > 2
    && GROUP_BODY.test(parts[0] ?? '')
    && parts.slice(1).every((part) => /^\d{3}$/.test(part))
  if (grouped) return { kind: 'value', decimal: normalizeZero(sign + parts.join('')) }
  return { kind: 'invalid', reason: 'syntax' }
}

function parseUnknown(text: string): ParsedNumber {
  const { sign, unsigned } = splitSign(text)
  if (/^\d+$/.test(unsigned)) return { kind: 'value', decimal: normalizeZero(sign + unsigned) }
  if (unsigned.includes('.') && unsigned.includes(',')) {
    const parsed = parseBothSeparators(unsigned)
    return parsed.kind === 'value' ? { ...parsed, decimal: normalizeZero(sign + parsed.decimal) } : parsed
  }
  if (unsigned.includes('.') || unsigned.includes(',')) {
    return parseSingleSeparator(sign, unsigned, unsigned.includes('.') ? '.' : ',')
  }
  return { kind: 'invalid', reason: 'syntax' }
}

export function parseImportNumber(
  value: unknown,
  formatOrOptions: ImportNumberFormat | ParseImportNumberOptions = 'unknown',
): ParsedNumber {
  const options: ParseImportNumberOptions =
    typeof formatOrOptions === 'string' ? { format: formatOrOptions } : formatOrOptions
  const format = options.format ?? 'unknown'

  if (value === null || value === undefined) return { kind: 'empty' }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { kind: 'invalid', reason: 'non_finite' }
    return { kind: 'value', decimal: normalizeZero(String(value)) }
  }
  if (typeof value !== 'string') return { kind: 'invalid', reason: 'syntax' }
  const text = value.trim()
  if (!text) return { kind: 'empty' }
  if (/\s/.test(text)) return { kind: 'invalid', reason: 'syntax' }
  if (NON_FINITE_PATTERN.test(text)) return { kind: 'invalid', reason: 'non_finite' }

  const exponent = text.match(EXPONENT_PATTERN)
  if (exponent) {
    if (!options.allowExponent) return { kind: 'invalid', reason: 'syntax' }
    const shift = Number(exponent[2])
    if (!Number.isSafeInteger(shift) || Math.abs(shift) > MAX_EXPONENT) {
      return { kind: 'invalid', reason: 'syntax' }
    }
    return { kind: 'value', decimal: applyExponent(exponent[1]!, shift) }
  }
  // String nunca perde letras para "virar número": 1e3/12abc/R$ são syntax.
  if (/[^0-9.,+-]/.test(text)) return { kind: 'invalid', reason: 'syntax' }

  const { sign, unsigned } = splitSign(text)
  if (!unsigned || /[+-]/.test(unsigned)) return { kind: 'invalid', reason: 'syntax' }

  if (format === 'pt-BR') {
    if (!PT_BR_PATTERN.test(text)) return { kind: 'invalid', reason: 'syntax' }
    return { kind: 'value', decimal: normalizeZero(sign + canonicalize(unsigned, '.', ',')) }
  }
  if (format === 'en-US') {
    if (!EN_US_PATTERN.test(text)) return { kind: 'invalid', reason: 'syntax' }
    return { kind: 'value', decimal: normalizeZero(sign + canonicalize(unsigned, ',', '.')) }
  }
  return parseUnknown(text)
}
