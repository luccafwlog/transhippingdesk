import { normalizeText } from '../lib/utils'

// Known port names -> UN/LOCODE for the desk's active lanes. B/L and manifest
// cells sometimes carry the city name ("SALVADOR, BRAZIL") instead of the code,
// so callers that persist pol/pod need this to store the canonical LOCODE.
// ponytail: hand-kept lookup for the handful of lanes in use; upgrade path =
// load a real UN/LOCODE dataset if the list grows.
const PORT_NAME_TO_LOCODE: Array<[string, string]> = [
  ['salvador', 'BRSSA'],
  ['vitoria', 'BRVIX'],
  ['taicang', 'CNTAC'],
  ['zhangjiagang', 'CNZJG'],
]

export function normalizePortCode(value: string | null | undefined) {
  const normalized = (value ?? '').trim().toUpperCase()
  if (!normalized) return null

  if (normalized === 'BRVIT') return 'BRVIX'
  if (/^[A-Z]{5}$/.test(normalized)) return normalized
  const embeddedLocode = normalized.match(/\b(?:BR|CN)[A-Z0-9]{3}\b/)?.[0]
  if (embeddedLocode) return embeddedLocode === 'BRVIT' ? 'BRVIX' : embeddedLocode

  const text = normalizeText(normalized)
  const match = PORT_NAME_TO_LOCODE
    .map(([name, code]) => ({ code, index: text.indexOf(name) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)[0]
  if (match) return match.code

  return normalized
}
