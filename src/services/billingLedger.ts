import { supabase } from './supabase'
import type { ConsolidatableReceivable } from '../types/database'

export type ConsolidatableReceivableFilters = {
  customerId?: number | null
  voyageId?: number | null
  search?: string | null
}

export async function listConsolidatableReceivables(filters: ConsolidatableReceivableFilters) {
  if (!filters.customerId) return [] as ConsolidatableReceivable[]

  const { data, error } = await supabase.rpc('list_consolidatable_receivables', {
    p_customer_id: filters.customerId,
    p_voyage_id: filters.voyageId ?? null,
    p_search: filters.search?.trim() || null,
  })

  if (error) throw error

  return ((data ?? []) as ConsolidatableReceivable[]).map((row) => ({
    ...row,
    receivable_id: Number(row.receivable_id),
    customer_id: Number(row.customer_id),
    voyage_id: row.voyage_id == null ? null : Number(row.voyage_id),
    individual_invoice_id: row.individual_invoice_id == null ? null : Number(row.individual_invoice_id),
    balance_brl: Number(row.balance_brl ?? 0),
    original_amount_brl: Number(row.original_amount_brl ?? 0),
  }))
}
