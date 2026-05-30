// Helpers puros (sem UI/hooks) extraídos de Viagens.tsx para reduzir o monólito
// e permitir teste unitário direto. Comportamento idêntico ao original.
import { countDistinctContainerNumbers } from '../lib/containerCounts'

export function normalizePortName(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase() || '-'
}

export function formatPortDisplayName(port: string | null | undefined) {
  const normalized = normalizePortName(port)

  const portNames: Record<string, string> = {
    CNNBO: 'NINGBO',
    CNNSA: 'NANSHA',
    CNSHG: 'SHANGHAI',
    CNTAC: 'TAICANG',
    BRVIT: 'VITORIA',
    VIX: 'VITORIA',
  }

  return portNames[normalized] ?? (String(port ?? '').trim() || '-')
}

export function summarizeContainerTypes(
  containers:
    | Array<{
        container_number?: string | null
        type?: string | null
      }>
    | null
    | undefined,
) {
  const groups = new Map<string, Array<{ container_number?: string | null }>>()

  for (const container of containers ?? []) {
    const type = String(container.type ?? '').trim() || 'Não informado'
    const current = groups.get(type)

    if (current) {
      current.push(container)
    } else {
      groups.set(type, [container])
    }
  }

  return Array.from(groups.entries())
    .map(([type, items]) => ({ type, count: countDistinctContainerNumbers(items) }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type, 'pt-BR'))
    .map(({ type, count }) => `${type}: ${count}`)
    .join(' | ')
}

export function summarizeUniqueValues(values: Array<string | null | undefined>) {
  const normalized = Array.from(
    new Set(
      values
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  return normalized.join(' | ')
}

export function summarizeOccurrences<T>(
  items: T[] | null | undefined,
  getLabel: (item: T) => string | null | undefined,
  fallbackLabel: string,
) {
  const counts = new Map<string, number>()

  for (const item of items ?? []) {
    const label = String(getLabel(item) ?? '').trim() || fallbackLabel
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'pt-BR'))
    .map(([label, count]) => `${label}: ${count}`)
    .join(' | ')
}

export function normalizeVoyageStatus(status: string | null): 'active' | 'completed' | 'cancelled' {
  if (status === 'completed' || status === 'cancelled') return status
  return 'active'
}

export function formatMetric(value: number | null | undefined) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount.toLocaleString('pt-BR') : '0'
}

export function tokenizeInfoValue(value: string) {
  if (!value || value === '-') return []

  const tokens = value
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean)

  return tokens.length > 1 ? tokens : []
}

export function stripFileExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, '')
}
