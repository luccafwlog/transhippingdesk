const VESSEL_PREFIX_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'ZHONG YUAN HAI YUN', aliases: ['ZYHY'] },
  { canonical: 'COSCO SHIPPING', aliases: ['CS', 'C.S.'] },
]

function normalizeVesselName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

export function canonicalizeVesselName(name: string) {
  const normalized = normalizeVesselName(name)

  for (const { canonical, aliases } of VESSEL_PREFIX_ALIASES) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeVesselName(alias)
      if (normalized === normalizedAlias) return canonical
      if (normalized.startsWith(`${normalizedAlias} `)) {
        return `${canonical} ${normalized.slice(normalizedAlias.length + 1)}`
      }
    }
  }

  return normalized
}
