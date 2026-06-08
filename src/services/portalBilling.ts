import { supabasePortal } from './supabase'
import type { InvoiceDetail } from './billing'
import type { ConsolidatableReceivable, DemurrageInvoiceItem } from '../types/database'

export type PortalSessionOverview = {
  customer_id: number
  customer_name: string
  customer_cnpj_cpf: string
  pending_balance: number | null
  contact_email: string | null
}

export type PortalInvoiceSummary = {
  id: number
  invoice_number: string | null
  issued_at: string | null
  due_date: string | null
  total_brl: number | null
  total_paid_brl: number | null
  balance_brl: number | null
  status: string | null
  invoice_type: string | null
  vessels: string[]
  voyages: string[]
  vessel_voyages: string[]
  bls: string[]
  pods: string[]
}

type PortalInvoiceContainer = {
  id: number
  bl_id: string | null
  container_number: string
  type: string | null
  seal_number: string | null
  gross_weight_kg: number | null
}

type PortalInvoiceDetail = InvoiceDetail & { containers: PortalInvoiceContainer[] }

export async function portalListConsolidatableReceivables() {
  const { data, error } = await supabasePortal.rpc('portal_list_consolidatable_receivables')

  if (error) throw error

  return ((data ?? []) as ConsolidatableReceivable[]).map((row) => ({
    ...row,
    balance_brl: Number(row.balance_brl ?? 0),
    original_amount_brl: Number(row.original_amount_brl ?? 0),
  }))
}

export async function portalListInvoices(): Promise<PortalInvoiceSummary[]> {
  const { data, error } = await supabasePortal.rpc('portal_list_invoices')

  if (error) throw error

  return ((data ?? []) as PortalInvoiceSummary[]).map((row) => ({
    ...row,
    total_brl: Number(row.total_brl ?? 0),
    total_paid_brl: Number(row.total_paid_brl ?? 0),
    balance_brl: Number(row.balance_brl ?? 0),
    vessels: row.vessels ?? [],
    voyages: row.voyages ?? [],
    vessel_voyages: row.vessel_voyages ?? [],
    bls: row.bls ?? [],
    pods: row.pods ?? [],
  }))
}

export async function portalInvoiceDetails(invoiceId: number) {
  const { data, error } = await supabasePortal.rpc('portal_invoice_details', {
    p_invoice_id: invoiceId,
  })

  if (error) throw error

  const payload = (data ?? {}) as {
    invoice?: InvoiceDetail['invoice']
    bls?: InvoiceDetail['bls']
    items?: InvoiceDetail['items']
    containers?: PortalInvoiceContainer[]
    payments?: InvoiceDetail['payments']
  }

  return {
    invoice: payload.invoice ?? null,
    bls: payload.bls ?? [],
    items: payload.items ?? [],
    containers: payload.containers ?? [],
    payments: payload.payments ?? [],
  } as PortalInvoiceDetail
}

export type PortalDemurrageInvoice = {
  id: number
  doc_number: string
  doc_date: string | null
  due_date: string | null
  billed_at: string | null
  paid_at: string | null
  total_usd: number
  frozen_roe: number | null
  frozen_total_brl: number | null
  status: string
  pix_payload: string | null
  dispute_open: boolean | null
  discount_type: string | null
  discount_value: number | null
  discount_mode: string | null
  bl_id: string
  pol: string | null
  pod: string | null
  voyage_number: string | null
  vessel_name: string | null
}

export type PortalDemurrageInvoiceDetail = {
  invoice: PortalDemurrageInvoice & { customer_name: string; customer_cnpj_cpf: string }
  items: DemurrageInvoiceItem[]
}

export async function portalListDemurrageInvoices(): Promise<PortalDemurrageInvoice[]> {
  const { data, error } = await supabasePortal.rpc('portal_list_demurrage_invoices')
  if (error) throw error
  return ((data ?? []) as PortalDemurrageInvoice[]).map((row) => ({
    ...row,
    total_usd: Number(row.total_usd ?? 0),
    frozen_total_brl: row.frozen_total_brl != null ? Number(row.frozen_total_brl) : null,
  }))
}

export async function portalGetDemurrageInvoiceDetail(invoiceId: number): Promise<PortalDemurrageInvoiceDetail> {
  const { data, error } = await supabasePortal.rpc('portal_get_demurrage_invoice_detail', { p_invoice_id: invoiceId })
  if (error) throw error
  const payload = (data ?? {}) as { invoice?: PortalDemurrageInvoiceDetail['invoice']; items?: DemurrageInvoiceItem[] }
  return { invoice: payload.invoice!, items: payload.items ?? [] }
}

export async function portalCreateConsolidation(input: { receivableIds: number[] }) {
  const { data, error } = await supabasePortal.rpc('portal_create_consolidation', {
    p_receivable_ids: input.receivableIds,
  })

  if (error) throw error
  return (data ?? {}) as Record<string, unknown>
}

export async function portalObsoleteConsolidation(invoiceId: number) {
  const { data, error } = await supabasePortal.rpc('portal_obsolete_consolidation', {
    p_invoice_id: invoiceId,
  })

  if (error) throw error
  return (data ?? {}) as Record<string, unknown>
}
