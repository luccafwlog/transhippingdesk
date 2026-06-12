import { supabase } from './supabase'
import type {
  ConsolidatableReceivable,
  ConsolidatedInvoiceResult,
  LedgerPaymentResult,
  ReconcileByTxidResult,
} from '../types/database'

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

export async function createConsolidatedInvoice(input: {
  customerId: number
  receivableIds: number[]
}) {
  const { data, error } = await supabase.rpc('create_local_consolidated_invoice', {
    p_customer_id: input.customerId,
    p_receivable_ids: input.receivableIds,
    p_actor: null,
  })
  if (error) throw error
  return data as unknown as ConsolidatedInvoiceResult
}
export async function registerLedgerInvoicePayment(input: {
  invoiceId: number
  amountBrl: number
  method?: string
  paidAt?: string | null
  pixTxid?: string | null
  source?: 'manual' | 'pix_extract'
  notes?: string | null
}) {
  const { data, error } = await supabase.rpc('register_ledger_invoice_payment', {
    p_invoice_id: input.invoiceId,
    p_amount_brl: input.amountBrl,
    p_method: input.method ?? 'pix',
    p_paid_at: input.paidAt ?? null,
    p_pix_txid: input.pixTxid ?? null,
    p_source: input.source ?? 'manual',
    p_notes: input.notes?.trim() || null,
    p_actor: null,
  })
  if (error) throw error
  return data as unknown as LedgerPaymentResult
}
export async function reconcileInvoicePaymentByTxid(input: {
  txid: string
  amountBrl: number
  paidAt?: string | null
}) {
  const { data, error } = await supabase.rpc('reconcile_invoice_payment_by_txid', {
    p_txid: input.txid,
    p_amount_brl: input.amountBrl,
    p_paid_at: input.paidAt ?? null,
  })
  if (error) throw error
  return data as unknown as ReconcileByTxidResult
}
