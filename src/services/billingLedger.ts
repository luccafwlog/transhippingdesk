import { z } from 'zod'
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

const consolidatedInvoiceResultSchema: z.ZodType<ConsolidatedInvoiceResult> = z.object({
  invoice_id: z.number(),
  invoice_number: z.string().nullable(),
  status: z.literal('issued'),
  invoice_type: z.literal('consolidated'),
  receivable_count: z.number(),
  total_brl: z.number(),
})

const ledgerPaymentResultSchema: z.ZodType<LedgerPaymentResult> = z.object({
  invoice_id: z.number(),
  payment_id: z.number(),
  status: z.enum(['paid', 'partially_paid']),
  amount_brl: z.number(),
  balance_brl: z.number(),
  refund_due_brl: z.number(),
  receivables_settled: z.number(),
  individuals_covered: z.number(),
  consolidated_obsoleted: z.number(),
})

const reconcileByTxidResultSchema: z.ZodType<ReconcileByTxidResult> = z.union([
  z.object({
    matched: z.literal(false),
    reason: z.string(),
  }),
  z.object({
    matched: z.literal(true),
    invoice_id: z.number(),
    settled: z.literal(false),
    reason: z.string(),
  }),
  z.object({
    matched: z.literal(true),
    invoice_id: z.number(),
    settled: z.literal(true),
    payment: ledgerPaymentResultSchema,
  }),
])

function parseRpcResult<T>(schema: z.ZodType<T>, data: unknown, rpcName: string): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new Error(`Resposta inválida de ${rpcName}.`)
  return parsed.data
}

function parseReceivableStatus(value: string): ConsolidatableReceivable['receivable_status'] {
  if (value === 'open' || value === 'partially_settled' || value === 'settled' || value === 'void') return value
  throw new Error(`Status de recebível inválido: ${value}`)
}

function parseEligibilityStatus(value: string): ConsolidatableReceivable['eligibility_status'] {
  if (value === 'eligible' || value === 'paid' || value === 'no_balance' || value === 'open_consolidated') return value
  throw new Error(`Elegibilidade de recebível inválida: ${value}`)
}

export async function listConsolidatableReceivables(
  filters: ConsolidatableReceivableFilters,
): Promise<ConsolidatableReceivable[]> {
  if (!filters.customerId) return [] as ConsolidatableReceivable[]

  const { data, error } = await supabase.rpc('list_consolidatable_receivables', {
    p_customer_id: filters.customerId,
    ...(filters.voyageId == null ? {} : { p_voyage_id: filters.voyageId }),
    ...(filters.search?.trim() ? { p_search: filters.search.trim() } : {}),
  })

  if (error) throw error

  return (data ?? []).map((row) => ({
    ...row,
    receivable_id: Number(row.receivable_id),
    customer_id: Number(row.customer_id),
    voyage_id: row.voyage_id == null ? null : Number(row.voyage_id),
    individual_invoice_id: row.individual_invoice_id == null ? null : Number(row.individual_invoice_id),
    balance_brl: Number(row.balance_brl ?? 0),
    original_amount_brl: Number(row.original_amount_brl ?? 0),
    receivable_status: parseReceivableStatus(row.receivable_status),
    eligibility_status: parseEligibilityStatus(row.eligibility_status),
  }))
}

export async function createConsolidatedInvoice(input: {
  customerId: number
  receivableIds: number[]
}) {
  const { data, error } = await supabase.rpc('create_local_consolidated_invoice', {
    p_customer_id: input.customerId,
    p_receivable_ids: input.receivableIds,
  })
  if (error) throw error
  return parseRpcResult(consolidatedInvoiceResultSchema, data, 'create_local_consolidated_invoice')
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
    ...(input.paidAt == null ? {} : { p_paid_at: input.paidAt }),
    ...(input.pixTxid == null ? {} : { p_pix_txid: input.pixTxid }),
    p_source: input.source ?? 'manual',
    ...(input.notes?.trim() ? { p_notes: input.notes.trim() } : {}),
  })
  if (error) throw error
  return parseRpcResult(ledgerPaymentResultSchema, data, 'register_ledger_invoice_payment')
}
export type InvoiceRefund = {
  id: number
  amount_brl: number
  status: 'pending' | 'settled' | 'cancelled'
  created_at: string
  settled_at: string | null
  notes: string | null
}

export async function listInvoiceRefunds(invoiceId: number): Promise<InvoiceRefund[]> {
  const { data, error } = await supabase.rpc('list_invoice_refunds', {
    p_invoice_id: invoiceId,
  })
  if (error) throw error
  return ((data ?? []) as InvoiceRefund[]).map((row) => ({
    ...row,
    id: Number(row.id),
    amount_brl: Number(row.amount_brl ?? 0),
  }))
}

export async function settleInvoiceRefund(refundId: number): Promise<void> {
  const { error } = await supabase.rpc('settle_invoice_refund', {
    p_refund_id: refundId,
  })
  if (error) throw error
}
export async function reconcileInvoicePaymentByTxid(input: {
  txid: string
  amountBrl: number
  paidAt?: string | null
}) {
  const { data, error } = await supabase.rpc('reconcile_invoice_payment_by_txid', {
    p_txid: input.txid,
    p_amount_brl: input.amountBrl,
    ...(input.paidAt == null ? {} : { p_paid_at: input.paidAt }),
  })
  if (error) throw error
  return parseRpcResult(reconcileByTxidResultSchema, data, 'reconcile_invoice_payment_by_txid')
}
