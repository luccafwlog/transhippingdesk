import { normalizeText, onlyDigits } from '../lib/utils'
import { supabase } from './supabase'

export type CustomerMatchRecord = {
  id: number
  name: string
}

export type CustomerMaps = {
  customersByDocument: Map<string, CustomerMatchRecord>
  customersByName: Map<string, CustomerMatchRecord>
  customersByCanonicalName: Map<string, CustomerMatchRecord>
}

export type CustomerMatchResult = {
  customer: CustomerMatchRecord
  matchType: 'document' | 'name'
}

/**
 * Forma canônica para comparação de nomes de empresa:
 * - Remove acentos e coloca em minúsculas (via normalizeText)
 * - Remove sufixos legais no final ANTES do strip de pontuação (ex: "S/A", "LTDA.")
 * - Strip de caracteres não-alfanuméricos (hífens, pontos, barras, etc.)
 * - Colapsa espaços extras
 *
 * Permite casar "ALLOG GALERIA - TRANSPORTES LTDA." com "ALLOG GALERIA TRANSPORTES"
 * e "SINCERELY LOGISTIC" com "SINCERELY LOGISTIC LTDA".
 */
export function canonicalizeName(name: string): string {
  return normalizeText(name)
    .replace(/[\s,]+(?:ltda\.?|s\/?a\.?|eireli|epp|me|lda\.?|inc\.?|corp\.?)\s*$/, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function loadCustomerMaps() {
  const customersByDocument = new Map<string, CustomerMatchRecord>()
  const customersByName = new Map<string, CustomerMatchRecord>()
  const customersByCanonicalName = new Map<string, CustomerMatchRecord>()

  let from = 0
  const pageSize = 1000

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from('customers')
      .select('id, cnpj_cpf, name')
      .order('id', { ascending: true })
      .range(from, to)

    if (error) throw error

    const batch = data ?? []
    for (const customer of batch) {
      const record: CustomerMatchRecord = { id: customer.id, name: customer.name }

      const document = onlyDigits(customer.cnpj_cpf)
      if (document) {
        customersByDocument.set(document, record)
      }

      const normalizedName = normalizeText(customer.name)
      if (normalizedName && !customersByName.has(normalizedName)) {
        customersByName.set(normalizedName, record)
      }

      const canonical = canonicalizeName(customer.name)
      if (canonical && !customersByCanonicalName.has(canonical)) {
        customersByCanonicalName.set(canonical, record)
      }
    }

    if (batch.length < pageSize) break
    from += pageSize
  }

  return { customersByDocument, customersByName, customersByCanonicalName }
}

export function findMatchedCustomer(
  candidate: {
    cnpjCpf?: string | null
    consignee?: string | null
  },
  maps: CustomerMaps,
): CustomerMatchResult | null {
  const document = onlyDigits(candidate.cnpjCpf)
  if (document) {
    const customerByDocument = maps.customersByDocument.get(document)
    if (customerByDocument) {
      return { customer: customerByDocument, matchType: 'document' }
    }
  }

  const consignee = candidate.consignee ?? ''

  const normalizedConsignee = normalizeText(consignee)
  if (normalizedConsignee) {
    const customerByName = maps.customersByName.get(normalizedConsignee)
    if (customerByName) {
      return { customer: customerByName, matchType: 'name' }
    }
  }

  // Fallback: nome canônico (tolera pontuação diferente e sufixos legais ausentes/presentes)
  const canonicalConsignee = canonicalizeName(consignee)
  if (canonicalConsignee) {
    const customerByCanonical = maps.customersByCanonicalName.get(canonicalConsignee)
    if (customerByCanonical) {
      return { customer: customerByCanonical, matchType: 'name' }
    }
  }

  return null
}
