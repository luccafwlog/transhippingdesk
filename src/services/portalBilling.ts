import { supabasePortal } from './supabase'
import type { InvoiceDetail } from './billing'
import type { ConsolidatableReceivable, DemurrageInvoiceItem } from '../types/database'

type PortalRpc = typeof supabasePortal.rpc

function rpc(name: string, args?: Record<string, unknown>): ReturnType<PortalRpc> {
  return (supabasePortal.rpc as any)(name, args ?? {})
}

export type PortalSessionOverview = {
  customer_id: number
  customer_name: string
  customer_cnpj_cpf: string
  pending_balance: number | null
  contact_email: string | null
  login_cnpj: string | null
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
  const { data, error } = await rpc('portal_list_consolidatable_receivables')

  if (error) throw error

  return ((data ?? []) as ConsolidatableReceivable[]).map((row) => ({
    ...row,
    balance_brl: Number(row.balance_brl ?? 0),
    original_amount_brl: Number(row.original_amount_brl ?? 0),
  }))
}

export async function portalListInvoices(): Promise<PortalInvoiceSummary[]> {
  const { data, error } = await rpc('portal_list_invoices')

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
  const { data, error } = await rpc('portal_invoice_details', {
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
  const { data, error } = await rpc('portal_list_demurrage_invoices')
  if (error) throw error
  return ((data ?? []) as PortalDemurrageInvoice[]).map((row) => ({
    ...row,
    total_usd: Number(row.total_usd ?? 0),
    frozen_total_brl: row.frozen_total_brl != null ? Number(row.frozen_total_brl) : null,
  }))
}

export async function portalGetDemurrageInvoiceDetail(invoiceId: number): Promise<PortalDemurrageInvoiceDetail> {
  const { data, error } = await rpc('portal_get_demurrage_invoice_detail', { p_invoice_id: invoiceId })
  if (error) throw error
  const payload = (data ?? {}) as { invoice?: PortalDemurrageInvoiceDetail['invoice']; items?: DemurrageInvoiceItem[] }
  return { invoice: payload.invoice!, items: payload.items ?? [] }
}

export async function portalCreateConsolidation(input: { receivableIds: number[] }) {
  const { data, error } = await rpc('portal_create_consolidation', {
    p_receivable_ids: input.receivableIds,
  })

  if (error) throw error
  return (data ?? {}) as Record<string, unknown>
}

export async function portalResolveLogin(login: string): Promise<string> {
  const { data, error } = await rpc('portal_resolve_login', {
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

export async function portalListNotifications(): Promise<PortalNotification[]> {
  const { data, error } = await rpc('portal_list_notifications', { p_limit: 20 })
  if (error) throw error
  return (data ?? []) as PortalNotification[]
}

export async function portalNotificationUnreadCount(): Promise<number> {
  const { data, error } = await rpc('portal_notification_unread_count')
  if (error) throw error
  return Number(data ?? 0)
}

export async function portalMarkNotificationRead(notificationId: number): Promise<void> {
  const { error } = await rpc('portal_mark_notification_read', { p_notification_id: notificationId })
  if (error) throw error
}

export async function portalMarkAllNotificationsRead(): Promise<void> {
  const { error } = await rpc('portal_mark_all_notifications_read')
  if (error) throw error
}

export async function portalOpenDemurrageDispute(demurrageInvoiceId: number, reason: string): Promise<void> {
  const { error } = await rpc('portal_open_demurrage_dispute', {
    p_demurrage_invoice_id: demurrageInvoiceId,
    p_reason: reason,
  })
  if (error) throw error
}

export type PortalDispute = {
  id: number
  doc_number: string
  dispute_subject: string | null
  dispute_reason: string | null
  dispute_status: string | null
  dispute_open: boolean
  dispute_notes: string | null
  bl_id: string
  total_usd: number
  created_at: string
}

export async function portalListDisputes(): Promise<PortalDispute[]> {
  const { data, error } = await rpc('portal_list_disputes')
  if (error) throw error
  return ((data ?? []) as PortalDispute[]).map((d) => ({
    ...d,
    total_usd: Number(d.total_usd ?? 0),
  }))
}

export type PortalProfile = {
  contact_email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export async function portalGetProfile(): Promise<PortalProfile> {
  const { data, error } = await rpc('portal_get_profile')
  if (error) throw error
  return (data ?? {}) as PortalProfile
}

export async function portalUpdateProfile(input: {
  contactEmail?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}): Promise<void> {
  const { error } = await rpc('portal_update_profile', {
    p_contact_email: input.contactEmail ?? null,
    p_phone: input.phone ?? null,
    p_address: input.address ?? null,
    p_city: input.city ?? null,
    p_state: input.state ?? null,
    p_zip: input.zip ?? null,
  })
  if (error) throw error
}

export async function portalObsoleteConsolidation(invoiceId: number) {
  const { data, error } = await rpc('portal_obsolete_consolidation', {
    p_invoice_id: invoiceId,
  })

  if (error) throw error
  return (data ?? {}) as Record<string, unknown>
}
