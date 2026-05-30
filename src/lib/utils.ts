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

export function formatBRL(value?: number | string | null) {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
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

export function onlyDigits(value?: string | null) {
  return (value ?? '').replace(/\D/g, '')
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
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}
