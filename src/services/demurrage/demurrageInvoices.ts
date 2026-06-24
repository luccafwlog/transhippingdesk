import { supabase } from '../supabase'
import { ensureDemurrageRatesLoaded, calculateDemurrage } from './demurrageRates'
import { buildTransshippingPixPayload } from '../../lib/pix'
import type { DemurrageInvoice, DemurrageInvoiceItem, RoeSource } from '../../types/database'

export type DemurrageInvoiceFilters = {
  status?: DemurrageInvoice['status'] | null
  customerId?: number | null
  blId?: string | null
  dateFrom?: string | null
  dateTo?: string | null
}

export type DemurrageInvoiceListItem = DemurrageInvoice & {
  customer?: { id: number; name: string; cnpj_cpf: string } | null
  bl?: { id: string; pol: string | null; pod: string | null; voyage?: { id: number; voyage_number: string; vessel?: { id: number; name: string } | null } | null } | null
}

function nextBusinessDay(fromDate?: string): string {
  const d = fromDate ? new Date(`${fromDate}T12:00:00`) : new Date()
  d.setDate(d.getDate() + 1)
  if (d.getDay() === 6) d.setDate(d.getDate() + 2)
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function genDemurrageDocnum(blId: string): string {
  const year = new Date().getFullYear()
  const ts = Date.now().toString(36).slice(-4).toUpperCase()
  const s = String(blId || '').toUpperCase()
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i)
    hash |= 0
  }
  const suffix = (Math.abs(hash) % 1000).toString().padStart(3, '0')
  return `DEM-${year}-${ts}${suffix}`
}

type DemurrageInvoiceItemSnapshot = {
  container_id: number
  container_number: string
  container_type: string
  discharge_date: string
  return_date: string
  total_days: number
  free_days: number
  days_p1: number
  rate_p1_usd: number
  days_p2: number
  rate_p2_usd: number
  subtotal_usd: number
}

async function createDemurrageInvoiceWithItems(input: {
  docNumber: string
  blId: string
  customerId: number
  totalUsd: number
  dueDate: string
  readyAt: string | null
  roeManual: boolean
  roe: number | null
  items: DemurrageInvoiceItemSnapshot[]
}): Promise<number> {
  const { data, error } = await supabase.rpc('create_demurrage_invoice_with_items' as never, {
    p_doc_number: input.docNumber,
    p_bl_id: input.blId,
    p_customer_id: input.customerId,
    p_total_usd: input.totalUsd,
    p_due_date: input.dueDate,
    p_ready_at: input.readyAt,
    p_roe_manual: input.roeManual,
    p_roe: input.roe,
    p_items: input.items,
  } as never)
  if (error) throw error

  const invoiceId = Number((data as { invoice_id?: number } | null)?.invoice_id)
  if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
    throw new Error('RPC de Demurrage nao retornou uma invoice valida.')
  }
  return invoiceId
}

export async function createInvoiceForBL(blId: string): Promise<number> {
  await ensureDemurrageRatesLoaded()

  const { data: bl, error: blErr } = await supabase
    .from('bls')
    .select('id, customer_id, free_time_override, demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd, demurrage_roe_manual, demurrage_roe')
    .eq('id', blId)
    .single()
  if (blErr) throw blErr
  if (!bl.customer_id) throw new Error('BL não possui cliente vinculado')

  const { data: containers, error: cErr } = await supabase
    .from('bl_containers')
    .select('id, container_number, type, discharge_date, return_date, demurrage_status')
    .eq('bl_id', blId)
    .eq('demurrage_status', 'overdue')
  if (cErr) throw cErr
  if (!containers?.length) throw new Error('Nenhum container em atraso para este BL')

  const items = containers
    .map((c) => {
      const calc = calculateDemurrage(c.type, c.discharge_date!, c.return_date!, bl.free_time_override, bl.demurrage_rate_override_p1_usd, bl.demurrage_rate_override_p2_usd)
      return { container: c, calc }
    })
    .filter((i) => i.calc.total_usd > 0)

  if (!items.length) throw new Error('Nenhum container com sobreestadia para este BL')

  const total_usd = items.reduce((sum, i) => sum + i.calc.total_usd, 0)
  const doc_number = genDemurrageDocnum(blId)
  const due_date = nextBusinessDay()
  const ready_at = containers.every((c) => c.return_date) ? containers.reduce((max, c) => (c.return_date! > max ? c.return_date! : max), containers[0].return_date!) : null

  const itemRows = items.map(({ container: c, calc }) => ({
    container_id: c.id,
    container_number: c.container_number,
    container_type: c.type ?? '',
    discharge_date: c.discharge_date!,
    return_date: c.return_date!,
    total_days: calc.total_days,
    free_days: calc.free_days,
    days_p1: calc.days_p1,
    rate_p1_usd: calc.rate_p1_usd,
    days_p2: calc.days_p2,
    rate_p2_usd: calc.rate_p2_usd,
    subtotal_usd: calc.total_usd,
  }))

  return createDemurrageInvoiceWithItems({
    docNumber: doc_number,
    blId,
    customerId: bl.customer_id,
    totalUsd: total_usd,
    dueDate: due_date,
    readyAt: ready_at,
    roeManual: bl.demurrage_roe_manual ?? false,
    roe: bl.demurrage_roe ?? null,
    items: itemRows,
  })
}

export async function createInvoiceForReturnedBL(blId: string): Promise<number | null> {
  await ensureDemurrageRatesLoaded()

  const { data: bl, error: blErr } = await supabase
    .from('bls')
    .select('id, customer_id, free_time_override, demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd, demurrage_roe_manual, demurrage_roe')
    .eq('id', blId)
    .single()
  if (blErr) throw blErr
  if (!bl.customer_id) return null

  const { data: containers, error: cErr } = await supabase
    .from('bl_containers')
    .select('id, container_number, type, discharge_date, return_date, demurrage_status')
    .eq('bl_id', blId)
    .eq('demurrage_status', 'returned')
    .not('discharge_date', 'is', null)
    .not('return_date', 'is', null)
  if (cErr) throw cErr
  if (!containers?.length) return null

  const items = containers
    .map((c) => {
      const calc = calculateDemurrage(c.type, c.discharge_date!, c.return_date!, bl.free_time_override, bl.demurrage_rate_override_p1_usd, bl.demurrage_rate_override_p2_usd)
      return { container: c, calc }
    })
    .filter((i) => i.calc.total_usd > 0)

  if (!items.length) return null

  const total_usd = items.reduce((sum, i) => sum + i.calc.total_usd, 0)
  const doc_number = genDemurrageDocnum(blId)
  const due_date = nextBusinessDay()
  const ready_at = containers.reduce((max, c) => (c.return_date! > max ? c.return_date! : max), containers[0].return_date!)

  const itemRows = items.map(({ container: c, calc }) => ({
    container_id: c.id,
    container_number: c.container_number,
    container_type: c.type ?? '',
    discharge_date: c.discharge_date!,
    return_date: c.return_date!,
    total_days: calc.total_days,
    free_days: calc.free_days,
    days_p1: calc.days_p1,
    rate_p1_usd: calc.rate_p1_usd,
    days_p2: calc.days_p2,
    rate_p2_usd: calc.rate_p2_usd,
    subtotal_usd: calc.total_usd,
  }))

  return createDemurrageInvoiceWithItems({
    docNumber: doc_number,
    blId,
    customerId: bl.customer_id,
    totalUsd: total_usd,
    dueDate: due_date,
    readyAt: ready_at,
    roeManual: bl.demurrage_roe_manual ?? false,
    roe: bl.demurrage_roe ?? null,
    items: itemRows,
  })
}

export async function issueInvoice(invoiceId: number, roe: number, roeSource: RoeSource = 'bcb_live'): Promise<void> {
  const { data: inv, error: fetchErr } = await supabase
    .from('demurrage_invoices')
    .select('total_usd, discount_mode, discount_value, first_billed_at, doc_number')
    .eq('id', invoiceId)
    .single()
  if (fetchErr) throw fetchErr

  let totalBRL = inv.total_usd * roe
  if (inv.discount_value && inv.discount_value > 0) {
    if (inv.discount_mode === 'percent') totalBRL = totalBRL * (1 - inv.discount_value / 100)
    else totalBRL = Math.max(0, totalBRL - inv.discount_value)
  }

  const today = new Date().toISOString().slice(0, 10)
  const pix_payload = buildTransshippingPixPayload(parseFloat(totalBRL.toFixed(2)), inv.doc_number)

  const { error } = await supabase.from('demurrage_invoices').update({
    status: 'issued',
    billed_at: today,
    first_billed_at: inv.first_billed_at ?? today,
    current_roe: roe,
    current_total_brl: parseFloat(totalBRL.toFixed(2)),
    roe_source: roeSource,
    pix_payload,
  }).eq('id', invoiceId)
  if (error) throw error
}

export async function unissueInvoice(invoiceId: number): Promise<void> {
  const { error } = await supabase.from('demurrage_invoices').update({
    status: 'draft',
    billed_at: null,
    current_roe: null,
    current_total_brl: null,
    pix_payload: null,
    due_date: nextBusinessDay(),
  }).eq('id', invoiceId)
  if (error) throw error
}

export async function markInvoicePaid(invoiceId: number, paidAt: string, roe?: number | null): Promise<void> {
  const { data: inv, error: fetchErr } = await supabase
    .from('demurrage_invoices')
    .select('status, current_roe, current_total_brl, total_usd, discount_mode, discount_value, doc_number')
    .eq('id', invoiceId)
    .single()
  if (fetchErr) throw fetchErr

  if (inv.status !== 'issued' && inv.status !== 'overdue') {
    throw new Error(`Fatura não pode ser marcada como paga no status atual: ${inv.status}`)
  }

  let frozenRoe = inv.current_roe
  let frozenTotalBrl = inv.current_total_brl

  if (frozenRoe == null && roe != null) {
    frozenRoe = roe
    let totalBRL = (inv.total_usd ?? 0) * roe
    if (inv.discount_value && inv.discount_value > 0) {
      if (inv.discount_mode === 'percent') totalBRL = totalBRL * (1 - Math.min(100, inv.discount_value) / 100)
      else totalBRL = Math.max(0, totalBRL - inv.discount_value)
    }
    frozenTotalBrl = parseFloat(totalBRL.toFixed(2))
  }

  const pix_payload = frozenTotalBrl && inv.doc_number ? buildTransshippingPixPayload(frozenTotalBrl, inv.doc_number) : undefined

  const { error } = await supabase.from('demurrage_invoices').update({
    status: 'paid',
    paid_at: paidAt,
    current_roe: frozenRoe,
    current_total_brl: frozenTotalBrl,
    ...(pix_payload ? { pix_payload } : {}),
  }).eq('id', invoiceId)
  if (error) throw error
}

export async function unmarkInvoicePaid(invoiceId: number): Promise<void> {
  const { error } = await supabase.from('demurrage_invoices').update({
    status: 'issued',
    paid_at: null,
  }).eq('id', invoiceId)
  if (error) throw error
}

export async function cancelDemurrageInvoice(invoiceId: number): Promise<void> {
  const { error } = await supabase.from('demurrage_invoices').update({ status: 'cancelled' }).eq('id', invoiceId)
  if (error) throw error
}

export async function listDemurrageInvoices(filters?: DemurrageInvoiceFilters): Promise<DemurrageInvoiceListItem[]> {
  let query = supabase
    .from('demurrage_invoices')
    .select(`*, customer:customers(id,name,cnpj_cpf), bl:bls(id,pol,pod,voyage:voyages(id,voyage_number,vessel:vessels(id,name)))`)
    .order('created_at', { ascending: false })

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.customerId) query = query.eq('customer_id', filters.customerId)
  if (filters?.blId) query = query.eq('bl_id', filters.blId)
  if (filters?.dateFrom) query = query.gte('doc_date', filters.dateFrom)
  if (filters?.dateTo) query = query.lte('doc_date', filters.dateTo)

  const { data, error } = await query.overrideTypes<DemurrageInvoiceListItem[], { merge: false }>()
  if (error) throw error
  return data ?? []
}

export async function getInvoiceDetail(invoiceId: number) {
  const [invRes, itemsRes] = await Promise.all([
    supabase
      .from('demurrage_invoices')
      .select(`*, customer:customers(id,name,cnpj_cpf), bl:bls(id,pol,pod,voyage:voyages(id,voyage_number,vessel:vessels(id,name)))`)
      .eq('id', invoiceId)
      .single()
      .overrideTypes<DemurrageInvoiceListItem, { merge: false }>(),
    supabase
      .from('demurrage_invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('container_number')
      .overrideTypes<DemurrageInvoiceItem[], { merge: false }>(),
  ])
  if (invRes.error) throw invRes.error
  if (itemsRes.error) throw itemsRes.error
  return {
    invoice: invRes.data!,
    items: itemsRes.data ?? [],
  }
}

export async function updateDemurrageInvoice(invoiceId: number, patch: Partial<Pick<DemurrageInvoice, 'discount_type' | 'discount_value' | 'discount_mode' | 'discount_justification' | 'discount_approver' | 'dispute_open' | 'dispute_subject' | 'dispute_reason' | 'dispute_status' | 'dispute_notes' | 'notes' | 'due_date' | 'roe' | 'roe_manual'>>): Promise<void> {
  const { error } = await supabase.from('demurrage_invoices').update(patch).eq('id', invoiceId)
  if (error) throw error
}
