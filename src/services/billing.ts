import { supabase } from './supabase'
import type { BLListItem, InvoiceItem, InvoicePayment, InvoiceSummary, InvoiceBlLink, Json } from '../types/database'

export type InvoiceStatusFilter = '' | 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled'

export type InvoiceFilters = {
  search: string
  customerId: string
  status: InvoiceStatusFilter
  dateFrom: string
  dateTo: string
  blSearch: string
  page: number
  pageSize: number
}

export type BillingReadyBlFilters = {
  customerId?: number | null
  voyageId?: number | null
  cargoMode?: 'container' | 'carga_solta' | null
}

export type InvoiceDetail = {
  invoice: (InvoiceSummary & {
    customer_name?: string | null
    customer_cnpj_cpf?: string | null
  }) | null
  bls: Array<
    InvoiceBlLink & {
      charge_status?: string | null
      financial_status?: string | null
      pol?: string | null
      pod?: string | null
      voyage_number?: string | null
      vessel_name?: string | null
    }
  >
  items: InvoiceItem[]
  payments: InvoicePayment[]
}

export type InvoiceLinkInfo = {
  id: number
  invoice_number: string | null
  status: string | null
  total_brl: number | null
  balance_brl: number | null
}

export type InvoiceLinksByBl = Record<string, InvoiceLinkInfo[]>

export type BillingCustomerOption = {
  id: number
  name: string
  cnpj_cpf: string
}

export async function listInvoices(filters: InvoiceFilters) {
  const from = (filters.page - 1) * filters.pageSize
  const to = from + filters.pageSize - 1

  let invoiceIdsByBl: number[] | null = null
  const normalizedBlSearch = normalizeText(filters.blSearch).toUpperCase()
  if (normalizedBlSearch) {
    const { data: invoiceLinks, error: linkError } = await supabase
      .from('invoice_bls')
      .select('invoice_id')
      .ilike('bl_id', `%${normalizedBlSearch}%`)
      .limit(2000)

    if (linkError) throw linkError
    invoiceIdsByBl = Array.from(
      new Set((invoiceLinks ?? []).map((row) => Number(row.invoice_id)).filter((value) => Number.isInteger(value))),
    )
    if (invoiceIdsByBl.length === 0) {
      return { rows: [] as InvoiceSummary[], count: 0 }
    }
  }

  let query = supabase
    .from('invoices')
    .select(
      `
      *,
      customer:customers(id,name,cnpj_cpf),
      invoice_bls(id,bl_id,subtotal_brl,subtotal_usd)
    `,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })

  if (filters.search) {
    query = query.or(`invoice_number.ilike.%${filters.search}%`)
  }

  if (filters.customerId) {
    query = query.eq('customer_id', Number(filters.customerId))
  }

  if (filters.status) {
    query = query.eq('status', filters.status)
  }

  if (filters.dateFrom) {
    query = query.gte('issued_at', `${filters.dateFrom}T00:00:00`)
  }
  if (filters.dateTo) {
    query = query.lte('issued_at', `${filters.dateTo}T23:59:59`)
  }

  if (invoiceIdsByBl) {
    query = query.in('id', invoiceIdsByBl)
  }

  const { data, error, count } = await query.range(from, to)
  if (error) throw error

  return {
    rows: (data ?? []) as unknown as InvoiceSummary[],
    count: count ?? 0,
  }
}

export async function listInvoiceDetails(invoiceId: number) {
  const { data, error } = await supabase.rpc('list_invoice_details', {
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

export async function listBillingReadyBls(filters?: BillingReadyBlFilters) {
  let query = supabase
    .from('bls')
    .select(
      `
      id,
      cargo_mode,
      customer_id,
      pol,
      pod,
      charge_status,
      financial_status,
      created_at,
      customer:customers(id,name,cnpj_cpf),
      voyage:voyages(id,voyage_number,vessel:vessels(id,name))
    `,
    )
    .eq('charge_status', 'ready_for_billing')
    .eq('financial_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1200)

  if (filters?.customerId) {
    query = query.eq('customer_id', filters.customerId)
  }
  if (filters?.voyageId) {
    query = query.eq('voyage_id', filters.voyageId)
  }
  if (filters?.cargoMode) {
    query = query.eq('cargo_mode', filters.cargoMode)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as BLListItem[]
}

export async function createInvoiceFromBls(input: {
  blIds: string[]
  customerId?: number | null
  dueDate?: string | null
  notes?: string | null
  issueNow?: boolean
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('create_invoice_from_bls', {
    p_bl_ids: input.blIds,
    p_customer_id: input.customerId ?? null,
    p_due_date: input.dueDate ?? null,
    p_notes: input.notes ?? null,
    p_issue_now: input.issueNow ?? true,
    p_actor: input.actorId ?? null,
  })

  if (error) throw error
  return (data ?? {}) as Json
}

export async function registerInvoicePayment(input: {
  invoiceId: number
  amountBrl: number
  paymentMethod: 'pix' | 'ted' | 'doc' | 'boleto' | 'outros'
  paidAt?: string | null
  notes?: string | null
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('register_invoice_payment', {
    p_invoice_id: input.invoiceId,
    p_amount_brl: input.amountBrl,
    p_payment_method: input.paymentMethod,
    p_paid_at: input.paidAt ?? null,
    p_notes: input.notes ?? null,
    p_actor: input.actorId ?? null,
  })

  if (error) throw error
  return (data ?? {}) as Json
}

export async function cancelInvoice(input: {
  invoiceId: number
  reason?: string | null
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('cancel_invoice', {
    p_invoice_id: input.invoiceId,
    p_reason: input.reason ?? null,
    p_actor: input.actorId ?? null,
  })

  if (error) throw error
  return (data ?? {}) as Json
}

export async function listInvoiceLinksByBls(blIds: string[]) {
  const normalizedIds = Array.from(new Set(blIds.map((value) => value.trim().toUpperCase()).filter(Boolean)))
  if (normalizedIds.length === 0) return {} as InvoiceLinksByBl

  const { data, error } = await supabase
    .from('invoice_bls')
    .select('bl_id, invoice:invoices(id, invoice_number, status, total_brl, balance_brl)')
    .in('bl_id', normalizedIds)

  if (error) {
    if (isPermissionError(error)) {
      return {} as InvoiceLinksByBl
    }
    throw error
  }

  const map: InvoiceLinksByBl = {}
  for (const row of data ?? []) {
    const blId = String(row.bl_id ?? '')
    if (!blId) continue

    const invoice = row.invoice as {
      id?: number
      invoice_number?: string | null
      status?: string | null
      total_brl?: number | null
      balance_brl?: number | null
    } | null

    if (!invoice?.id) continue

    if (!map[blId]) {
      map[blId] = []
    }
    map[blId].push({
      id: invoice.id,
      invoice_number: invoice.invoice_number ?? null,
      status: invoice.status ?? null,
      total_brl: invoice.total_brl ?? null,
      balance_brl: invoice.balance_brl ?? null,
    })
  }

  for (const key of Object.keys(map)) {
    map[key] = map[key]
      .slice()
      .sort((left, right) => right.id - left.id)
  }

  return map
}

export async function listBillingCustomers(search = '') {
  let query = supabase.from('customers').select('id,name,cnpj_cpf').order('name', { ascending: true }).limit(300)
  const normalizedSearch = String(search ?? '').trim()
  if (normalizedSearch.length >= 2) {
    query = query.or(`name.ilike.%${normalizedSearch}%,cnpj_cpf.ilike.%${normalizedSearch}%`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as BillingCustomerOption[]
}

function isPermissionError(error: { code?: string | null; message?: string | null }) {
  return error.code === '42501' || String(error.message ?? '').toLowerCase().includes('permission denied')
}

function normalizeText(value: string) {
  return String(value ?? '').trim()
}
