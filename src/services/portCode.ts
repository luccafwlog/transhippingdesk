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

  const text = normalizeText(normalized)
  for (const [name, code] of PORT_NAME_TO_LOCODE) {
    if (text.includes(name)) return code
  }

  return normalized
}
