const VESSEL_PREFIX_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'ZHONG YUAN HAI YUN', aliases: ['ZYHY'] },
  { canonical: 'COSCO SHIPPING', aliases: ['CS', 'C.S.', 'C S'] },
]

export function normalizeVesselName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .replace(/[^A-Z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

export function canonicalizeVesselName(name: string) {
  const tokens = stripVesselDesignation(normalizeVesselName(name).split(' ').filter(Boolean))
  const normalized = tokens.join(' ')

  for (const { canonical, aliases } of VESSEL_PREFIX_ALIASES) {
    for (const alias of aliases) {
      const aliasTokens = normalizeVesselName(alias).split(' ').filter(Boolean)
      if (!startsWithTokens(tokens, aliasTokens)) continue
      const suffix = tokens.slice(aliasTokens.length).join(' ')
      return suffix ? `${canonical} ${suffix}` : canonical
    }
  }

  return normalized
}

/**
 * Normaliza a representação textual do IMO sem converter o identificador em
 * número. O prefixo de etiqueta é comum em planilhas e não altera a chave.
 */
export function normalizeVesselImo(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().toUpperCase()
  if (!normalized) return null
  return normalized.replace(/^IMO[\s:./-]*/, '') || null
}

function stripVesselDesignation(tokens: string[]): string[] {
  if (tokens[0] === 'M' && tokens[1] === 'V') return tokens.slice(2)
  if (tokens[0] === 'MV' || tokens[0] === 'VSL' || tokens[0] === 'VESSEL') return tokens.slice(1)
  return tokens
}

function startsWithTokens(value: string[], prefix: string[]): boolean {
  if (prefix.length > value.length) return false
  for (let index = 0; index < prefix.length; index += 1) {
    if (value[index] !== prefix[index]) return false
  }
  return true
}
