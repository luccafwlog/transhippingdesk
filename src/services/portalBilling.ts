import type { InvoiceDetail } from './billing'
import type { ConsolidatableReceivable, DemurrageInvoiceItem } from '../types/database'
import { callPortalRpc, clientPortalScope, type PortalScope } from './portalScope'
import { supabasePortal } from './supabase'

export type PortalSessionOverview = {
  customer_id: number
  customer_name: string
  customer_cnpj_cpf: string
  pending_balance: number | null
  contact_email: string | null
  login_cnpj: string | null
  account_active?: boolean
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

export type PortalInvoiceDetail = Omit<InvoiceDetail, 'invoice'> & {
  invoice: (NonNullable<InvoiceDetail['invoice']> & { pix_payload: string | null }) | null
  containers: PortalInvoiceContainer[]
}

export async function portalListConsolidatableReceivables(scope: PortalScope = clientPortalScope) {
  const data = await callPortalRpc<ConsolidatableReceivable[]>(scope, 'portal_list_consolidatable_receivables')
  return ((data ?? []) as ConsolidatableReceivable[]).map((row) => ({
    ...row,
    balance_brl: Number(row.balance_brl ?? 0),
    original_amount_brl: Number(row.original_amount_brl ?? 0),
  }))
}

export async function portalListInvoices(scope: PortalScope = clientPortalScope): Promise<PortalInvoiceSummary[]> {
  const data = await callPortalRpc<PortalInvoiceSummary[]>(scope, 'portal_list_invoices')
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

export async function portalInvoiceDetails(invoiceId: number, scope: PortalScope = clientPortalScope) {
  const data = await callPortalRpc<unknown>(scope, 'portal_invoice_details', { p_invoice_id: invoiceId })

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
  current_roe: number | null
  current_total_brl: number | null
  roe_source: string | null
  updated_at: string | null
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

export type PortalCurrentRoe = {
  roe: number
  updatedAt: string
}

export async function portalGetCurrentRoe(scope: PortalScope = clientPortalScope): Promise<PortalCurrentRoe | null> {
  const data = await callPortalRpc<unknown>(scope, 'portal_get_current_roe')
  const row = (Array.isArray(data) ? data[0] : data) as { roe?: number | string; updated_at?: string } | null
  if (row?.roe == null || !row.updated_at) return null
  return { roe: Number(row.roe), updatedAt: row.updated_at }
}

export async function portalListDemurrageInvoices(scope: PortalScope = clientPortalScope): Promise<PortalDemurrageInvoice[]> {
  const data = await callPortalRpc<PortalDemurrageInvoice[]>(scope, 'portal_list_demurrage_invoices')
  return ((data ?? []) as PortalDemurrageInvoice[]).map((row) => ({
    ...row,
    total_usd: Number(row.total_usd ?? 0),
    current_total_brl: row.current_total_brl != null ? Number(row.current_total_brl) : null,
  }))
}

export async function portalGetDemurrageInvoiceDetail(invoiceId: number, scope: PortalScope = clientPortalScope): Promise<PortalDemurrageInvoiceDetail> {
  const data = await callPortalRpc<unknown>(scope, 'portal_get_demurrage_invoice_detail', { p_invoice_id: invoiceId })
  const payload = (data ?? {}) as { invoice?: PortalDemurrageInvoiceDetail['invoice']; items?: DemurrageInvoiceItem[] }
  return { invoice: payload.invoice!, items: payload.items ?? [] }
}

export async function portalCreateConsolidation(input: { receivableIds: number[] }, scope: PortalScope = clientPortalScope) {
  const data = await callPortalRpc(scope, 'portal_create_consolidation', { p_receivable_ids: input.receivableIds })
  return (data ?? {}) as Record<string, unknown>
}

export async function portalResolveLogin(login: string): Promise<string> {
  const { data, error } = await supabasePortal.rpc('portal_resolve_login', {
    p_login: login,
  })
  if (error) throw error
  return String(data ?? '')
}

export type PortalNotification = {
  id: number
  type: string
  title: string
  message: string
  link: string | null
  read: boolean
  created_at: string
}

export async function portalListNotifications(scope: PortalScope = clientPortalScope): Promise<PortalNotification[]> {
  const data = await callPortalRpc<PortalNotification[]>(scope, 'portal_list_notifications', { p_limit: 20 })
  return (data ?? []) as PortalNotification[]
}

export async function portalNotificationUnreadCount(scope: PortalScope = clientPortalScope): Promise<number> {
  const data = await callPortalRpc<unknown>(scope, 'portal_notification_unread_count')
  return Number(data ?? 0)
}

export async function portalMarkNotificationRead(notificationId: number, scope: PortalScope = clientPortalScope): Promise<void> {
  await callPortalRpc(scope, 'portal_mark_notification_read', { p_notification_id: notificationId })
}

export async function portalMarkAllNotificationsRead(scope: PortalScope = clientPortalScope): Promise<void> {
  await callPortalRpc(scope, 'portal_mark_all_notifications_read')
}

export async function portalOpenDemurrageDispute(demurrageInvoiceId: number, reason: string, scope: PortalScope = clientPortalScope): Promise<void> {
  await callPortalRpc(scope, 'portal_open_demurrage_dispute', { p_demurrage_invoice_id: demurrageInvoiceId, p_reason: reason })
}

export type PortalProfile = {
  contact_email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export async function portalGetProfile(scope: PortalScope = clientPortalScope): Promise<PortalProfile> {
  const data = await callPortalRpc<PortalProfile>(scope, 'portal_get_profile')
  return (data ?? {}) as PortalProfile
}

export async function portalUpdateProfile(input: {
  contactEmail?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}, scope: PortalScope = clientPortalScope): Promise<void> {
  await callPortalRpc(scope, 'portal_update_profile', {
    ...(input.contactEmail == null ? {} : { p_contact_email: input.contactEmail }),
    ...(input.phone == null ? {} : { p_phone: input.phone }),
    ...(input.address == null ? {} : { p_address: input.address }),
    ...(input.city == null ? {} : { p_city: input.city }),
    ...(input.state == null ? {} : { p_state: input.state }),
    ...(input.zip == null ? {} : { p_zip: input.zip }),
  })
}

export async function portalObsoleteConsolidation(invoiceId: number, scope: PortalScope = clientPortalScope) {
  const data = await callPortalRpc(scope, 'portal_obsolete_consolidation', { p_invoice_id: invoiceId })
  return (data ?? {}) as Record<string, unknown>
}
