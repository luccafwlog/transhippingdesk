export function normalizePortCode(value: string | null | undefined) {
  const normalized = (value ?? '').trim().toUpperCase()
  if (!normalized) return null

  if (normalized === 'BRVIT') return 'BRVIX'

  return normalized
}
