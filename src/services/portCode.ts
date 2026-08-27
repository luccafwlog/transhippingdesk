import { normalizeText } from '../lib/utils'

// Known port names -> UN/LOCODE for the desk's active lanes. B/L and manifest
// cells sometimes carry the city name ("SALVADOR, BRAZIL") instead of the code,
// so callers that persist pol/pod need this to store the canonical LOCODE.
// ponytail: hand-kept lookup for the lanes in use; the CSSC showcase ports
// are listed here so Portal schedules match manifest POL/POD codes. Upgrade
// path = load a real UN/LOCODE dataset if the list grows.
const PORT_NAME_TO_LOCODE: Array<[string, string]> = [
  ['salvador', 'BRSSA'],
  ['vitoria', 'BRVIX'],
  ['vitória', 'BRVIX'],
  ['pecem', 'BRPEC'],
  ['pecém', 'BRPEC'],
  ['santos', 'BRSSZ'],
  ['paranagua', 'BRPNG'],
  ['paranaguá', 'BRPNG'],
  ['itajai', 'BRITJ'],
  ['itajaí', 'BRITJ'],
  ['navegantes', 'BRITJ'],
  ['rio grande', 'BRRIG'],
  ['suape', 'BRSUA'],
  ['recife', 'BRSUA'],
  ['rio de janeiro', 'BRRIO'],
  ['manaus', 'BRMAO'],
  ['qingdao', 'CNTAO'],
  ['tsingtao', 'CNTAO'],
  ['cnqdg', 'CNTAO'],
  ['shanghai', 'CNSHA'],
  ['cnshg', 'CNSHA'],
  ['taicang', 'CNTAC'],
  ['taikang', 'CNTAC'],
  ['cntai', 'CNTAC'],
  ['cntag', 'CNTAC'],
  ['ningbo', 'CNNGB'],
  ['cnnbo', 'CNNGB'],
  ['nansha', 'CNNSA'],
  ['cnnan', 'CNNSA'],
  ['guangzhou', 'CNNSA'],
  ['cngzu', 'CNNSA'],
  ['zhangjiagang', 'CNZJG'],
  ['xiamen', 'CNXMN'],
  ['shekou', 'CNSHK'],
  ['shenzhen', 'CNSHK'],
  ['cnszk', 'CNSHK'],
  ['cnshe', 'CNSHK'],
  ['yantian', 'CNYTN'],
  ['hong kong', 'HKHKG'],
  ['hongkong', 'HKHKG'],
]

export function normalizePortCode(value: string | null | undefined) {
  const normalized = (value ?? '').trim().toUpperCase()
  if (!normalized) return null

  if (normalized === 'BRVIT') return 'BRVIX'
  const text = normalizeText(normalized)
  const match = PORT_NAME_TO_LOCODE
    .map(([name, code]) => ({ code, index: text.indexOf(normalizeText(name)) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)[0]
  if (match) return match.code

  if (/^[A-Z]{5}$/.test(normalized)) return normalized
  const embeddedLocode = normalized.match(/\b(?:BR|CN|HK)[A-Z0-9]{3}\b/)?.[0]
  if (embeddedLocode) return embeddedLocode === 'BRVIT' ? 'BRVIX' : embeddedLocode

  return normalized
}

/** Todas as formas persistidas historicamente para o mesmo porto. */
export function portCodeVariants(value: string | null | undefined): string[] {
  const canonical = normalizePortCode(value)
  if (!canonical) return []
  const variants = new Set([canonical])
  for (const [name, code] of PORT_NAME_TO_LOCODE) {
    if (code === canonical) variants.add(name.toUpperCase())
  }
  if (canonical === 'BRVIX') variants.add('BRVIT')
  return [...variants]
}
