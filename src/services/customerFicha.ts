import { supabase } from './supabase'
import type { CustomerContact, CustomerRateOverride, DemurrageInvoice } from '../types/database'

export type FichaLocalInvoiceRow = {
  id: number
  invoice_number: string | null
  issued_at: string | null
  due_date: string | null
  total_brl: number | null
  balance_brl: number | null
  status: string | null
}

export type FichaDemurrageInvoiceRow = Pick<DemurrageInvoice, 'id' | 'doc_number' | 'bl_id' | 'due_date' | 'billed_at' | 'paid_at' | 'total_usd' | 'current_total_brl' | 'status' | 'dispute_open' | 'dispute_status' | 'dispute_subject'>
export type FichaReceivableRow = { id: number; bl_id: string; original_amount_brl: number; settled_amount_brl: number; balance_brl: number; status: string }
export type FichaPaymentRow = { id: number; amount_brl: number; payment_method: string | null; paid_at: string | null; notes: string | null; invoice: { id: number; invoice_number: string | null } | null }
export type FichaOverrideRow = Pick<CustomerRateOverride, 'id' | 'override_value' | 'valid_from' | 'valid_to' | 'notes'> & { charge_item: { id: number; name: string | null; currency: string | null; charge_table: { id: number; name: string | null; pod: string | null; cargo_mode: string | null } | null } | null }
export type FichaManualChargeBlRow = { bl_id: string; manual_count: number }
export type FichaPendingReconciliationRow = { id: string; consignee: string | null; customer_reconciliation_status: string | null }
export type FichaRunningDemurrageRow = { container_id: number; container_number: string | null; bl_id: string; discharge_date: string }

export type ConsolidatedBalance = { localBrl: number; demurrageBrl: number; totalBrl: number }
const UNPAID_DEMURRAGE_STATUSES = new Set(['issued', 'overdue'])

export function buildConsolidatedBalance(
  localInvoices: Array<{ status: string | null; balance_brl: number | null }>,
  demurrageInvoices: Array<{ status: string | null; current_total_brl: number | null }>,
): ConsolidatedBalance {
  const localBrl = localInvoices.filter((row) => row.status === 'issued' || row.status === 'overdue').reduce((sum, row) => sum + Number(row.balance_brl ?? 0), 0)
  const demurrageBrl = demurrageInvoices.filter((row) => UNPAID_DEMURRAGE_STATUSES.has(row.status ?? '')).reduce((sum, row) => sum + Number(row.current_total_brl ?? 0), 0)
  return { localBrl, demurrageBrl, totalBrl: localBrl + demurrageBrl }
}

export type CustomerTimelineEvent = { kind: string; at: string; label: string; detail?: string | null; link?: string }
type TimelineSources = {
  auditLogs: Array<{ id: number; field_name: string; old_value: string | null; new_value: string | null; changed_at: string; justification: string | null; changed_by: string | null }>
  portalEvents: Array<{ id: number; new_decision: string | null; new_situation: string | null; reason: string | null; created_at: string }>
  contacts: Array<Pick<CustomerContact, 'id' | 'name' | 'created_at'>>
  localInvoices: Array<{ id: number; invoice_number: string | null; issued_at: string | null; status: string | null }>
  demurrageInvoices: Array<{ id: number; doc_number: string; billed_at: string | null; paid_at: string | null; status: string | null }>
  bls: Array<{ id: string; created_at: string | null }>
}

export function buildCustomerTimeline(sources: TimelineSources): CustomerTimelineEvent[] {
  const events: CustomerTimelineEvent[] = [
    ...sources.auditLogs.map((row) => ({ kind: 'cadastro_audit', at: row.changed_at, label: `Cadastro alterado: ${row.field_name}`, detail: row.justification })),
    ...sources.portalEvents.map((row) => ({ kind: 'portal_event', at: row.created_at, label: `Portal: ${row.new_situation ?? row.new_decision ?? 'evento'}`, detail: row.reason })),
    ...sources.contacts.filter((row) => row.created_at).map((row) => ({ kind: 'contact_created', at: row.created_at!, label: `Contato criado: ${row.name ?? 'sem nome'}` })),
    ...sources.localInvoices.filter((row) => row.issued_at).map((row) => ({ kind: 'local_invoice_issued', at: row.issued_at!, label: `Invoice local emitida: ${row.invoice_number ?? `INV-${row.id}`}`, link: `/faturamento?customer=${row.id}&invoice=${row.id}` })),
    ...sources.demurrageInvoices.filter((row) => row.billed_at).map((row) => ({ kind: 'demurrage_invoice_issued', at: row.billed_at!, label: `Invoice de demurrage emitida: ${row.doc_number}`, link: '/demurrage' })),
    ...sources.bls.filter((row) => row.created_at).map((row) => ({ kind: 'bl_created', at: row.created_at!, label: `B/L criado: ${row.id}`, link: `/manifestos/${row.id}` })),
  ]
  return events.sort((a, b) => b.at.localeCompare(a.at))
}

function isPermissionError(error: { code?: string | null; message?: string | null }) {
  return error.code === '42501' || String(error.message ?? '').toLowerCase().includes('permission denied')
}

export async function fetchCustomerDemurrageInvoices(customerId: number) {
  const { data, error } = await supabase.from('demurrage_invoices').select('id, doc_number, bl_id, due_date, billed_at, paid_at, total_usd, current_total_brl, status, dispute_open, dispute_status, dispute_subject').eq('customer_id', customerId).order('billed_at', { ascending: false }).range(0, 199).overrideTypes<FichaDemurrageInvoiceRow[], { merge: false }>()
  if (error) { if (isPermissionError(error)) return { rows: [], denied: true }; throw error }
  return { rows: data ?? [], denied: false }
}

export async function fetchCustomerReceivables(customerId: number) {
  const { data, error } = await supabase.from('bl_receivables').select('id, bl_id, original_amount_brl, settled_amount_brl, balance_brl, status').eq('customer_id', customerId).order('created_at', { ascending: false }).range(0, 199).overrideTypes<FichaReceivableRow[], { merge: false }>()
  if (error) { if (isPermissionError(error)) return { rows: [], denied: true }; throw error }
  return { rows: data ?? [], denied: false }
}

export async function fetchCustomerPayments(customerId: number) {
  const { data, error } = await supabase.from('payments').select('id, amount_brl, payment_method, paid_at, notes, invoice:invoices!inner(id, invoice_number, customer_id)').eq('invoice.customer_id', customerId).order('paid_at', { ascending: false }).range(0, 199).overrideTypes<FichaPaymentRow[], { merge: false }>()
  if (error) { if (isPermissionError(error)) return { rows: [], denied: true }; throw error }
  return { rows: data ?? [], denied: false }
}

export async function fetchCustomerRateOverrides(customerId: number) {
  const { data, error } = await supabase.from('customer_rate_overrides').select('id, override_value, valid_from, valid_to, notes, charge_item:charge_table_items(id, name, currency, charge_table:charge_tables(id, name, pod, cargo_mode))').eq('customer_id', customerId).order('created_at', { ascending: false }).range(0, 199).overrideTypes<FichaOverrideRow[], { merge: false }>()
  if (error) throw error
  return data ?? []
}

export async function fetchCustomerManualChargeBls(customerId: number) {
  const { data, error } = await supabase.from('charge_calculations').select('bl_id, bls!inner(customer_id)').eq('bls.customer_id', customerId).eq('source', 'manual').range(0, 499)
  if (error) throw error
  const counts = new Map<string, number>()
  for (const row of data ?? []) if (row.bl_id) counts.set(row.bl_id, (counts.get(row.bl_id) ?? 0) + 1)
  return Array.from(counts, ([bl_id, manual_count]) => ({ bl_id, manual_count }))
}

export async function fetchCustomerPendingReconciliation(customerId: number) {
  const { data, error } = await supabase.from('bls').select('id, consignee, customer_reconciliation_status').eq('customer_id', customerId).in('customer_reconciliation_status', ['matched_document', 'matched_name']).order('created_at', { ascending: false }).range(0, 199).overrideTypes<FichaPendingReconciliationRow[], { merge: false }>()
  if (error) throw error
  return data ?? []
}

export async function fetchCustomerRunningDemurrage(customerId: number) {
  const { data, error } = await supabase.from('bl_containers').select('id, container_number, bl_id, discharge_date, bls!inner(customer_id)').eq('bls.customer_id', customerId).eq('demurrage_status', 'overdue').not('discharge_date', 'is', null).is('return_date', null).range(0, 199).overrideTypes<Array<{ id: number; container_number: string | null; bl_id: string; discharge_date: string }>, { merge: false }>()
  if (error) throw error
  return (data ?? []).map((row) => ({ container_id: row.id, container_number: row.container_number, bl_id: row.bl_id, discharge_date: row.discharge_date }))
}

export async function fetchCustomerTimelineSources(customerId: number, contacts: Array<Pick<CustomerContact, 'id' | 'name' | 'created_at'>>, bls: Array<{ id: string; created_at: string | null }>) {
  const [auditLogs, portalEvents, localInvoices, demurrage] = await Promise.all([
    supabase.from('audit_logs').select('id, field_name, old_value, new_value, changed_at, justification, changed_by').eq('entity_type', 'customer').eq('entity_id', String(customerId)).order('changed_at', { ascending: false }).range(0, 99),
    supabase.from('portal_provisioning_events').select('id, new_decision, new_situation, reason, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).range(0, 99),
    supabase.from('invoices').select('id, invoice_number, issued_at, status').eq('customer_id', customerId).order('issued_at', { ascending: false }).range(0, 99),
    supabase.from('demurrage_invoices').select('id, doc_number, billed_at, paid_at, status').eq('customer_id', customerId).order('billed_at', { ascending: false }).range(0, 99),
  ])
  for (const result of [auditLogs, portalEvents]) if (result.error) throw result.error
  const localRows = localInvoices.error && !isPermissionError(localInvoices.error) ? (() => { throw localInvoices.error })() : (localInvoices.data ?? [])
  const demurrageRows = demurrage.error && !isPermissionError(demurrage.error) ? (() => { throw demurrage.error })() : (demurrage.data ?? [])
  return buildCustomerTimeline({
    auditLogs: (auditLogs.data ?? []).filter((row) => row.changed_at).map((row) => ({ ...row, changed_at: row.changed_at! })),
    portalEvents: portalEvents.data ?? [],
    contacts,
    localInvoices: (localRows ?? []).map((row) => ({ ...row, invoice_number: row.invoice_number ?? null })),
    demurrageInvoices: demurrageRows,
    bls,
  })
}
