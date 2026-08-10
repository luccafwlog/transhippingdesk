export function normalizePortName(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase() || '-'
}

export function formatPortDisplayName(port: string | null | undefined) {
  const normalized = normalizePortName(port)

  const portNames: Record<string, string> = {
    CNNGB: 'NINGBO',
    CNNBO: 'NINGBO',
    CNNSA: 'NANSHA',
    CNSHG: 'SHANGHAI',
    CNTAC: 'TAICANG',
    BRVIT: 'VITORIA',
    VIX: 'VITORIA',
  }

  return portNames[normalized] ?? (String(port ?? '').trim() || '-')
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
