import { supabase } from './supabase'
import type { InvoiceItem, InvoicePayment, InvoiceSummary, InvoiceBlLink, Json } from '../types/database'
import { buildTransshippingPixPayload } from '../lib/pix'

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

export type BillingReadyBl = {
  id: string
  cargo_mode: 'container' | 'carga_solta' | null
  customer_id: number | null
  pol: string | null
  pod: string | null
  charge_status: string | null
  financial_status: string | null
  created_at: string | null
  customer?: { id: number; name: string; cnpj_cpf: string } | null
  voyage?: {
    id: number
    voyage_number: string
    vessel?: {
      id: number
      name: string
      carrier?: { id: number; name: string; scac: string | null } | null
    } | null
  } | null
  bl_containers?: Array<{ container_number: string | null }> | null
  billing_total_brl: number
  container_count: number
}

export type BillingReadyBlDiagnostics = {
  totalBls: number
  eligibleBls: number
  alreadyInvoicedBls: number
  notReadyBls: number
}

export type GraniteBillingReadyBl = {
  id: string
  bl_number: string
  client_id: number | null
  loading_port: string | null
  discharge_port: string | null
  charge_status: string
  client: { id: number; name: string; cnpj_cpf: string } | null
  manifest: { vessel_voyage: string } | null
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

async function persistPixPayload(invoiceId: number): Promise<void> {
  const { data: inv, error: fetchError } = await supabase
    .from('invoices')
    .select('invoice_number, total_brl')
    .eq('id', invoiceId)
    .single()
  if (fetchError || !inv?.invoice_number || !inv.total_brl || Number(inv.total_brl) <= 0) return
  const pix_payload = buildTransshippingPixPayload(
    parseFloat(Number(inv.total_brl).toFixed(2)),
    inv.invoice_number,
  )
  const { error: updateError } = await supabase.from('invoices').update({ pix_payload }).eq('id', invoiceId)
  if (updateError) console.error('[billing] persistPixPayload update failed', updateError)
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

  const result: InvoiceDetail = {
    invoice: payload.invoice ?? null,
    bls: payload.bls ?? [],
    items: payload.items ?? [],
    payments: payload.payments ?? [],
  }

  // Consolidated ledger invoices have no invoice_items/invoice_bls; render them
  // from invoice_receivable_links so the existing PDF/print path works unchanged.
  if (result.invoice && result.items.length === 0) {
    const { data: links, error: linksError } = await supabase
      .from('invoice_receivable_links')
      .select('id, bl_id, subtotal_brl, bl_snapshot')
      .eq('invoice_id', invoiceId)

    if (!linksError && links && links.length > 0) {
      const voyageIds = Array.from(
        new Set(
          links
            .map((l) => {
              const snap = (l.bl_snapshot ?? {}) as { voyage_id?: number | null }
              return snap.voyage_id == null ? null : Number(snap.voyage_id)
            })
            .filter((v): v is number => v != null),
        ),
      )

      const voyageMap = new Map<number, { voyage_number: string | null; vessel_name: string | null }>()
      if (voyageIds.length > 0) {
        const { data: voyages } = await supabase
          .from('voyages')
          .select('id, voyage_number, vessel:vessels(name)')
          .in('id', voyageIds)
        for (const v of (voyages ?? []) as unknown as Array<{
          id: number
          voyage_number: string | null
          vessel: { name: string | null } | null
        }>) {
          voyageMap.set(Number(v.id), { voyage_number: v.voyage_number ?? null, vessel_name: v.vessel?.name ?? null })
        }
      }

      result.bls = links.map((l) => {
        const snap = (l.bl_snapshot ?? {}) as { voyage_id?: number | null; pol?: string | null; pod?: string | null }
        const voy = snap.voyage_id == null ? undefined : voyageMap.get(Number(snap.voyage_id))
        return {
          id: Number(l.id),
          invoice_id: invoiceId,
          bl_id: l.bl_id,
          charge_status_snapshot: null,
          financial_status_snapshot: null,
          subtotal_brl: Number(l.subtotal_brl ?? 0),
          subtotal_usd: 0,
          created_at: null,
          pol: snap.pol ?? null,
          pod: snap.pod ?? null,
          voyage_number: voy?.voyage_number ?? null,
          vessel_name: voy?.vessel_name ?? null,
        }
      })

      result.items = links.map((l) => ({
        id: Number(l.id),
        invoice_id: invoiceId,
        charge_calculation_id: null,
        description: `BL ${l.bl_id} - Taxas locais`,
        quantity: 1,
        unit_value_brl: Number(l.subtotal_brl ?? 0),
        total_value_brl: Number(l.subtotal_brl ?? 0),
        bl_id: l.bl_id,
        manifest_id: null,
        charge_table_id: null,
        charge_item_id: null,
        source: 'ledger',
        currency: 'BRL',
        unit_value_usd: null,
        total_value_usd: null,
        pricing_rule_version_id: null,
        billing_run_id: null,
        calculation_key: null,
        snapshot_payload: null,
      }))
    }
  }

  // Lazy backfill: generate pix_payload for existing invoices that don't have one
  const inv = result.invoice
  const activeStatuses = ['issued', 'partially_paid', 'overdue', 'paid']
  if (
    inv &&
    !inv.pix_payload &&
    inv.invoice_number &&
    inv.total_brl &&
    Number(inv.total_brl) > 0 &&
    activeStatuses.includes(inv.status ?? '')
  ) {
    const pix_payload = buildTransshippingPixPayload(
      parseFloat(Number(inv.total_brl).toFixed(2)),
      inv.invoice_number,
    )
    const { error: backfillError } = await supabase.from('invoices').update({ pix_payload }).eq('id', invoiceId)
    if (!backfillError) {
      result.invoice = { ...inv, pix_payload } as typeof inv
    }
  }

  return result
}

export async function listBillingReadyBls(filters?: BillingReadyBlFilters) {
  if (!filters?.customerId) {
    return [] as BillingReadyBl[]
  }

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
      voyage:voyages(id,voyage_number,vessel:vessels(id,name,carrier:carriers(id,name,scac))),
      bl_containers(container_number)
    `,
    )
    .eq('charge_status', 'ready_for_billing')
    .or('financial_status.is.null,financial_status.eq.pending')
    .eq('customer_id', filters.customerId)
    .order('created_at', { ascending: false })
    .limit(1200)

  if (filters?.voyageId) {
    query = query.eq('voyage_id', filters.voyageId)
  }
  if (filters?.cargoMode) {
    query = query.eq('cargo_mode', filters.cargoMode)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as unknown as BillingReadyBl[]
  const blIds = rows.map((row) => row.id)
  if (blIds.length === 0) return []

  const [{ data: invoiceLinks, error: invoiceLinkError }, { data: charges, error: chargeError }] = await Promise.all([
    supabase
      .from('invoice_bls')
      .select('bl_id, invoice:invoices(status)')
      .in('bl_id', blIds),
    supabase
      .from('charge_calculations')
      .select('bl_id,total_value_brl,status')
      .in('bl_id', blIds)
      .in('status', ['calculated', 'reviewed', 'ready_for_billing']),
  ])

  if (invoiceLinkError) throw invoiceLinkError
  if (chargeError) throw chargeError

  const linkedBlIds = new Set<string>()
  for (const row of invoiceLinks ?? []) {
    const invoice = row.invoice as { status?: string | null } | null
    if (invoice && invoice.status !== 'cancelled') {
      linkedBlIds.add(String(row.bl_id))
    }
  }

  const totalsByBl = new Map<string, number>()
  for (const row of charges ?? []) {
    const blId = String(row.bl_id ?? '')
    if (!blId) continue
    totalsByBl.set(blId, (totalsByBl.get(blId) ?? 0) + Number(row.total_value_brl ?? 0))
  }

  return rows
    .filter((row) => !linkedBlIds.has(row.id))
    .map((row) => {
      const containerNumbers = new Set(
        (row.bl_containers ?? [])
          .map((container) => container.container_number?.trim())
          .filter(Boolean),
      )
      return {
        ...row,
        billing_total_brl: totalsByBl.get(row.id) ?? 0,
        container_count: containerNumbers.size,
      }
    })
}

export async function getBillingReadyBlDiagnostics(filters?: BillingReadyBlFilters) {
  if (!filters?.customerId) {
    return null as BillingReadyBlDiagnostics | null
  }

  let query = supabase
    .from('bls')
    .select('id,charge_status,financial_status')
    .eq('customer_id', filters.customerId)
    .limit(2000)

  if (filters?.voyageId) {
    query = query.eq('voyage_id', filters.voyageId)
  }
  if (filters?.cargoMode) {
    query = query.eq('cargo_mode', filters.cargoMode)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as Array<{ id: string; charge_status: string | null; financial_status: string | null }>
  const blIds = rows.map((row) => row.id)
  if (blIds.length === 0) {
    return { totalBls: 0, eligibleBls: 0, alreadyInvoicedBls: 0, notReadyBls: 0 }
  }

  const { data: invoiceLinks, error: invoiceLinkError } = await supabase
    .from('invoice_bls')
    .select('bl_id, invoice:invoices(status)')
    .in('bl_id', blIds)

  if (invoiceLinkError) throw invoiceLinkError

  const linkedBlIds = new Set<string>()
  for (const row of invoiceLinks ?? []) {
    const invoice = row.invoice as { status?: string | null } | null
    if (invoice && invoice.status !== 'cancelled') {
      linkedBlIds.add(String(row.bl_id))
    }
  }

  let eligibleBls = 0
  let alreadyInvoicedBls = 0
  let notReadyBls = 0

  for (const row of rows) {
    const financialStatus = row.financial_status ?? 'pending'
    const hasInvoice = linkedBlIds.has(row.id)

    if (row.charge_status === 'ready_for_billing' && financialStatus === 'pending' && !hasInvoice) {
      eligibleBls += 1
    } else if (hasInvoice || financialStatus !== 'pending') {
      alreadyInvoicedBls += 1
    } else {
      notReadyBls += 1
    }
  }

  return {
    totalBls: rows.length,
    eligibleBls,
    alreadyInvoicedBls,
    notReadyBls,
  }
}

export async function listBillingReadyGraniteBls(filters?: { customerId?: number | null }) {
  let query = supabase
    .from('granite_bls')
    .select(
      `
      id,
      bl_number,
      client_id,
      loading_port,
      discharge_port,
      charge_status,
      client:customers(id,name,cnpj_cpf),
      manifest:granite_manifests(vessel_voyage)
    `,
    )
    .eq('charge_status', 'ready_for_billing')
    .order('created_at', { ascending: false })
    .limit(500)

  if (filters?.customerId) {
    query = query.eq('client_id', filters.customerId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as GraniteBillingReadyBl[]
}

export async function createInvoiceFromGraniteBls(input: {
  graniteBlIds: string[]
  customerId?: number | null
  dueDate?: string | null
  notes?: string | null
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('create_invoice_from_granite_bls', {
    p_granite_bl_ids: input.graniteBlIds,
    p_customer_id: input.customerId ?? null,
    p_due_date: input.dueDate ?? null,
    p_notes: input.notes ?? null,
    p_actor: input.actorId ?? null,
  })

  if (error) throw error

  const result = (data ?? {}) as Json
  const invoiceId = (result as { invoice_id?: number }).invoice_id
  if (invoiceId) {
    await persistPixPayload(invoiceId)
  }

  return result
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

  const result = (data ?? {}) as Json
  const invoiceId = (result as { invoice_id?: number }).invoice_id
  if (invoiceId) {
    await persistPixPayload(invoiceId)
    await supabase.rpc('link_invoice_to_ledger', { p_invoice_id: invoiceId })
  }

  return result
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
  const normalizedSearch = String(search ?? '').trim()
  const safeSearch = normalizedSearch.replace(/[(),]/g, ' ')
  const digitSearch = normalizedSearch.replace(/\D/g, '')

  let query = supabase
    .from('customers')
    .select('id,name,cnpj_cpf')
    .order('name', { ascending: true })
    .limit(normalizedSearch.length >= 2 ? 100 : 200)

  if (normalizedSearch.length >= 2) {
    const terms = [`name.ilike.%${safeSearch}%,cnpj_cpf.ilike.%${safeSearch}%`]
    if (digitSearch.length >= 2) terms.push(`cnpj_cpf.ilike.%${digitSearch}%`)
    query = query.or(terms.join(','))
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
