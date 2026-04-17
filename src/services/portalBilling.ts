import { supabase } from './supabase'
import type { InvoiceDetail } from './billing'

export type PortalLoginResult = {
  token: string
  customer_id: number
  customer_name: string
  customer_cnpj_cpf: string
  contact_email: string | null
  expires_at: string
}

export type PortalSessionOverview = {
  customer_id: number
  customer_name: string
  customer_cnpj_cpf: string
  pending_balance: number | null
  contact_email: string | null
}

export type PortalPendingBl = {
  bl_id: string
  pol: string | null
  pod: string | null
  charge_status: string | null
  financial_status: string | null
  billing_hold_reason: string | null
  subtotal_brl: number | null
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
}

export async function portalLogin(cnpjCpf: string, password: string) {
  const { data, error } = await supabase.rpc('portal_login', {
    p_cnpj_cpf: cnpjCpf,
    p_password: password,
  })

  if (error) throw error
  return (data ?? {}) as PortalLoginResult
}

export async function portalLogout(sessionToken: string) {
  const { error } = await supabase.rpc('portal_logout', {
    p_session_token: sessionToken,
  })

  if (error) throw error
}

export async function portalGetSessionOverview(sessionToken: string) {
  const { data, error } = await supabase.rpc('portal_get_session_overview', {
    p_session_token: sessionToken,
  })

  if (error) throw error
  return (data ?? {}) as PortalSessionOverview
}

export async function portalListPendingBls(sessionToken: string) {
  const { data, error } = await supabase.rpc('portal_list_pending_bls', {
    p_session_token: sessionToken,
  })

  if (error) throw error

  return ((data ?? []) as PortalPendingBl[]).map((row) => ({
    ...row,
    subtotal_brl: Number(row.subtotal_brl ?? 0),
  }))
}

export async function portalListInvoices(sessionToken: string) {
  const { data, error } = await supabase.rpc('portal_list_invoices', {
    p_session_token: sessionToken,
  })

  if (error) throw error

  return ((data ?? []) as PortalInvoiceSummary[]).map((row) => ({
    ...row,
    total_brl: Number(row.total_brl ?? 0),
    total_paid_brl: Number(row.total_paid_brl ?? 0),
    balance_brl: Number(row.balance_brl ?? 0),
  }))
}

export async function portalInvoiceDetails(sessionToken: string, invoiceId: number) {
  const { data, error } = await supabase.rpc('portal_invoice_details', {
    p_session_token: sessionToken,
    p_invoice_id: invoiceId,
  })

  if (error) throw error

  const payload = (data ?? {}) as {
    invoice?: InvoiceDetail['invoice']
    bls?: InvoiceDetail['bls']
    items?: InvoiceDetail['items']
    payments?: InvoiceDetail['payments']
  }

  return {
    invoice: payload.invoice ?? null,
    bls: payload.bls ?? [],
    items: payload.items ?? [],
    payments: payload.payments ?? [],
  } as InvoiceDetail
}

export async function portalCreateConsolidation(input: {
  sessionToken: string
  blIds: string[]
  dueDate?: string | null
  notes?: string | null
}) {
  const { data, error } = await supabase.rpc('portal_create_consolidation', {
    p_session_token: input.sessionToken,
    p_bl_ids: input.blIds,
    p_due_date: input.dueDate ?? null,
    p_notes: input.notes ?? null,
  })

  if (error) throw error
  return (data ?? {}) as Record<string, unknown>
}
