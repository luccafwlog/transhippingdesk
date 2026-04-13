import { normalizeText, onlyDigits } from '../lib/utils'
import { supabase } from './supabase'

export type CustomerMatchRecord = {
  id: number
  name: string
}

export type CustomerMaps = {
  customersByDocument: Map<string, CustomerMatchRecord>
  customersByName: Map<string, CustomerMatchRecord>
}

export type CustomerMatchResult = {
  customer: CustomerMatchRecord
  matchType: 'document' | 'name'
}

export async function loadCustomerMaps() {
  const customersByDocument = new Map<string, CustomerMatchRecord>()
  const customersByName = new Map<string, CustomerMatchRecord>()

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
      const document = onlyDigits(customer.cnpj_cpf)
      if (document) {
        customersByDocument.set(document, {
          id: customer.id,
          name: customer.name,
        })
      }

      const normalizedName = normalizeText(customer.name)
      if (normalizedName && !customersByName.has(normalizedName)) {
        customersByName.set(normalizedName, {
          id: customer.id,
          name: customer.name,
        })
      }
    }

    if (batch.length < pageSize) break
    from += pageSize
  }

  return { customersByDocument, customersByName }
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
      return {
        customer: customerByDocument,
        matchType: 'document',
      }
    }
  }

  const normalizedConsignee = normalizeText(candidate.consignee ?? '')
  if (normalizedConsignee) {
    const customerByName = maps.customersByName.get(normalizedConsignee)
    if (customerByName) {
      return {
        customer: customerByName,
        matchType: 'name',
      }
    }
  }

  return null
}
