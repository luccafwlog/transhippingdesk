import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Remove caracteres que podem alterar o parser de filtros do PostgREST
// (vírgula, parênteses, ponto, dois-pontos, aspas, asterisco, barra) ou os
// curingas do LIKE (% e _). Evita injeção de filtro e enumeração/DoS via
// curingas em chamadas .or()/.ilike() que interpolam input do usuário.
export function escapeFilterTerm(value: string) {
  return value.replace(/[%_,.():*"\\]/g, ' ').trim()
}

// Para uso em .ilike(coluna, valor): o valor é parametrizado pelo PostgREST,
// então só os curingas do LIKE (% _) e a barra de escape representam risco
// (enumeração via `_`, varredura completa via `%`). Mantém o restante da
// pontuação do termo, ao contrário de escapeFilterTerm (usado em .or()).
export function sanitizeLikeTerm(value: string) {
  return value.replace(/[%_\\]/g, '').trim()
}

export function formatBRL(value?: number | string | null) {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(amount) ? amount : 0)
}

export function formatCountLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function formatUSD(value?: number | string | null) {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)
}

export function formatDate(value?: string | null) {
  if (!value) return '-'

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch
    return `${day}/${month}/${year}`
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value))
}

export function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function formatDateOnlyToBRShort(value: string) {
  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!dateOnlyMatch) return null
  const [, , month, day] = dateOnlyMatch
  return `${day}/${month}`
}

export function formatShortDateSafe(value?: string | null) {
  if (!value) return '-'

  const shortDate = formatDateOnlyToBRShort(value)
  if (shortDate) return shortDate

  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(value))
}

export function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

export function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function onlyDigits(value?: string | null) {
  return (value ?? '').replace(/\D/g, '')
}

// Gera uma senha forte aleatoria (sem caracteres ambiguos) para o sistema
// provisionar acesso ao portal sem o operador precisar definir/ver senha fixa.
export function generateStrongPassword(length = 16) {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_'
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  let result = ''
  for (let index = 0; index < length; index += 1) {
    result += charset[values[index] % charset.length]
  }
  return result
}

export function formatCnpjCpf(value?: string | null) {
  const digits = onlyDigits(value)

  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  }

  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  }

  return value || '-'
}

export function asString(value: unknown) {
  return String(value ?? '').trim()
}

export function toNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/[A-Z]+/gi, '')
    .replace(/\s+/g, '')

  if (!cleaned) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  const decimalSeparator = lastComma > lastDot ? ',' : lastDot > -1 ? '.' : ''
  const normalized = decimalSeparator
    ? cleaned
        .replace(new RegExp(`\\${decimalSeparator === ',' ? '.' : ','}`, 'g'), '')
        .replace(decimalSeparator, '.')
    : cleaned
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

export function chunkArray<T>(values: T[], chunkSize: number) {
  if (!values.length) return []
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }
  return chunks
}

// Remove o prefixo redundante "BL <id> - " da descricao de um item de fatura,
// usado tanto no PDF quanto no detalhe da invoice (o B/L ja aparece em coluna propria).
export function stripBlPrefix(description: string | null | undefined, blId: string | null | undefined): string {
  if (!description) return ''
  if (!blId) return description
  const prefix = `BL ${blId} - `
  return description.startsWith(prefix) ? description.slice(prefix.length) : description
}
