import { supabase } from './supabase'
import { buildTransshippingPixPayload } from '../lib/pix'
import type { DemurrageCalcResult, DemurrageInvoice, DemurrageInvoiceItem, DemurrageContainerListItem, PixTransaction } from '../types/database'

// ── Rate groups (port of DM rates.js RATES array) ─────────────
type RateGroup = {
  aliases: string[]
  freeUntil: number
  p1: { range: [number, number]; usd: number }
  p2: { range: [number, number]; usd: number }
}

const RATE_GROUPS: RateGroup[] = [
  { aliases: ['20GP', '20G0', '20HC', '20HQ', '22G1', '20G1'], freeUntil: 21, p1: { range: [22, 30], usd: 30 }, p2: { range: [31, Infinity], usd: 50 } },
  { aliases: ['40GP', '40G0', '40HC', '40HQ', '40G1', '42G1', '45G1'], freeUntil: 21, p1: { range: [22, 30], usd: 60 }, p2: { range: [31, Infinity], usd: 80 } },
  { aliases: ['20FR', '20OT', '20FT'], freeUntil: 21, p1: { range: [22, 30], usd: 50 }, p2: { range: [31, Infinity], usd: 80 } },
  { aliases: ['40FR', '40OT', '40FT'], freeUntil: 21, p1: { range: [22, 30], usd: 100 }, p2: { range: [31, Infinity], usd: 140 } },
  { aliases: ['20RF', '20RQ', '20R1'], freeUntil: 10, p1: { range: [11, 19], usd: 95 }, p2: { range: [20, Infinity], usd: 110 } },
  { aliases: ['40RF', '40RQ', '40R1', '45R1'], freeUntil: 10, p1: { range: [11, 19], usd: 190 }, p2: { range: [20, Infinity], usd: 220 } },
]

const DEFAULT_RATE: RateGroup = RATE_GROUPS[0]

type ResolvedRate = {
  freeUntil: number
  p1: { range: [number, number]; usd: number }
  p2: { range: [number, number]; usd: number }
}

export function getRate(containerType: string | null, freeTimeOverride?: number | null, ov1?: number | null, ov2?: number | null): ResolvedRate {
  const type = (containerType ?? '').toUpperCase().trim()
  const group = RATE_GROUPS.find((g) => g.aliases.includes(type)) ?? DEFAULT_RATE

  let freeUntil = group.freeUntil
  let p1 = { ...group.p1 }
  let p2 = { ...group.p2, range: [...group.p2.range] as [number, number] }

  if (freeTimeOverride != null && freeTimeOverride !== group.freeUntil) {
    const delta = freeTimeOverride - group.freeUntil
    freeUntil = freeTimeOverride
    p1 = { range: [group.p1.range[0] + delta, group.p1.range[1] + delta], usd: group.p1.usd }
    p2 = { range: [group.p2.range[0] + delta, Infinity], usd: group.p2.usd }
  }

  return {
    freeUntil,
    p1: { range: p1.range, usd: ov1 ?? p1.usd },
    p2: { range: p2.range, usd: ov2 ?? p2.usd },
  }
}

function noonMs(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getTime()
}

export function calculateDemurrage(
  containerType: string | null,
  dischargeDate: string,
  returnDate: string,
  freeTimeOverride?: number | null,
  ov1?: number | null,
  ov2?: number | null,
): DemurrageCalcResult {
  const rate = getRate(containerType, freeTimeOverride, ov1, ov2)
  const dc = Math.round((noonMs(returnDate) - noonMs(dischargeDate)) / 86400000)

  if (dc <= rate.freeUntil) {
    return { total_days: dc, free_days: dc, days_p1: 0, rate_p1_usd: rate.p1.usd, days_p2: 0, rate_p2_usd: rate.p2.usd, total_usd: 0, status: 'within_free_time' }
  }

  const diasP1 = Math.max(0, Math.min(dc, rate.p1.range[1]) - rate.p1.range[0] + 1)
  const diasP2 = Math.max(0, dc - rate.p2.range[0] + 1)
  const totalUSD = diasP1 * rate.p1.usd + diasP2 * rate.p2.usd

  return { total_days: dc, free_days: rate.freeUntil, days_p1: diasP1, rate_p1_usd: rate.p1.usd, days_p2: diasP2, rate_p2_usd: rate.p2.usd, total_usd: totalUSD, status: 'overdue' }
}

export function computeTotalBRL(invoice: Pick<DemurrageInvoice, 'status' | 'frozen_total_brl' | 'total_usd' | 'discount_mode' | 'discount_value'>, liveRoe: number | null): number {
  if ((invoice.status === 'issued' || invoice.status === 'paid') && invoice.frozen_total_brl != null) {
    return invoice.frozen_total_brl
  }
  if (!liveRoe) return 0
  let brl = invoice.total_usd * liveRoe
  if (invoice.discount_value && invoice.discount_value > 0) {
    if (invoice.discount_mode === 'percent') {
      brl = brl * (1 - invoice.discount_value / 100)
    } else {
      brl = Math.max(0, brl - invoice.discount_value)
    }
  }
  return brl
}

export function nextBusinessDay(fromDate?: string): string {
  const d = fromDate ? new Date(`${fromDate}T12:00:00`) : new Date()
  d.setDate(d.getDate() + 1)
  if (d.getDay() === 6) d.setDate(d.getDate() + 2)
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function genDemurrageDocnum(blId: string): string {
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

// ── DB: Containers ─────────────────────────────────────────────

export type DemurrageContainerFilters = {
  customerId?: number | null
  blId?: string | null
  voyageId?: number | null
}

export async function listDemurrageContainers(filters?: DemurrageContainerFilters): Promise<DemurrageContainerListItem[]> {
  let query = supabase
    .from('bl_containers')
    .select(`
      id, bl_id, container_number, type, discharge_date, return_date, demurrage_status,
      bl:bls(
        id, pol, pod, free_time_override,
        demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd,
        demurrage_roe_manual, demurrage_roe, voyage_id,
        customer:customers(id, name, cnpj_cpf),
        voyage:voyages(id, voyage_number, vessel:vessels(id, name))
      )
    `)
    .not('discharge_date', 'is', null)
    .neq('demurrage_status', 'returned')
    .order('discharge_date', { ascending: false })

  if (filters?.blId) query = query.eq('bl_id', filters.blId)

  const { data, error } = await query
  if (error) throw error

  let rows = (data ?? []) as unknown as DemurrageContainerListItem[]

  if (filters?.customerId) {
    rows = rows.filter((r) => (r.bl as { customer?: { id: number } | null } | null)?.customer?.id === filters.customerId)
  }
  if (filters?.voyageId) {
    rows = rows.filter((r) => (r.bl as { voyage_id?: number } | null)?.voyage_id === filters.voyageId)
  }

  return rows
}

export async function updateContainerReturnDate(containerId: number, returnDate: string | null): Promise<void> {
  if (!returnDate) {
    const { error } = await supabase.from('bl_containers').update({ return_date: null, demurrage_status: 'within_free_time' }).eq('id', containerId)
    if (error) throw error
    return
  }

  const { data: row, error: fetchErr } = await supabase
    .from('bl_containers')
    .select('type, discharge_date, bl:bls(free_time_override, demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd)')
    .eq('id', containerId)
    .single()
  if (fetchErr) throw fetchErr

  const bl = (row as unknown as { bl?: { free_time_override?: number | null; demurrage_rate_override_p1_usd?: number | null; demurrage_rate_override_p2_usd?: number | null } | null }).bl
  const calc = calculateDemurrage(row.type, row.discharge_date ?? '', returnDate, bl?.free_time_override, bl?.demurrage_rate_override_p1_usd, bl?.demurrage_rate_override_p2_usd)

  const demurrage_status = calc.status === 'overdue' ? 'overdue' : 'within_free_time'
  const { error } = await supabase.from('bl_containers').update({ return_date: returnDate, demurrage_status }).eq('id', containerId)
  if (error) throw error
}

// ── DB: Invoice CRUD ──────────────────────────────────────────

export async function createInvoiceForBL(blId: string): Promise<number> {
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

  const items = containers.map((c) => {
    const calc = calculateDemurrage(c.type, c.discharge_date!, c.return_date!, bl.free_time_override, bl.demurrage_rate_override_p1_usd, bl.demurrage_rate_override_p2_usd)
    return { container: c, calc }
  })

  const total_usd = items.reduce((sum, i) => sum + i.calc.total_usd, 0)
  const doc_number = genDemurrageDocnum(blId)
  const due_date = nextBusinessDay()
  const ready_at = containers.every((c) => c.return_date) ? containers.reduce((max, c) => (c.return_date! > max ? c.return_date! : max), containers[0].return_date!) : null

  const { data: inv, error: invErr } = await supabase
    .from('demurrage_invoices')
    .insert({ doc_number, bl_id: blId, customer_id: bl.customer_id, total_usd, due_date, ready_at, roe_manual: bl.demurrage_roe_manual ?? false, roe: bl.demurrage_roe ?? null })
    .select('id')
    .single()
  if (invErr) throw invErr

  const itemRows = items.map(({ container: c, calc }) => ({
    invoice_id: inv.id,
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

  const { error: itemErr } = await supabase.from('demurrage_invoice_items').insert(itemRows)
  if (itemErr) throw itemErr

  return inv.id
}

// Called automatically when all containers in a BL are returned; creates invoice only if demurrage is owed.
export async function createInvoiceForReturnedBL(blId: string): Promise<number | null> {
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

  const { data: inv, error: invErr } = await supabase
    .from('demurrage_invoices')
    .insert({ doc_number, bl_id: blId, customer_id: bl.customer_id, total_usd, due_date, ready_at, roe_manual: bl.demurrage_roe_manual ?? false, roe: bl.demurrage_roe ?? null })
    .select('id')
    .single()
  if (invErr) throw invErr

  const itemRows = items.map(({ container: c, calc }) => ({
    invoice_id: inv.id,
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

  const { error: itemErr } = await supabase.from('demurrage_invoice_items').insert(itemRows)
  if (itemErr) throw itemErr

  return inv.id
}

export async function issueInvoice(invoiceId: number, roe: number): Promise<void> {
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
    frozen_roe: roe,
    frozen_total_brl: parseFloat(totalBRL.toFixed(2)),
    pix_payload,
  }).eq('id', invoiceId)
  if (error) throw error
}

export async function unissueInvoice(invoiceId: number): Promise<void> {
  const { error } = await supabase.from('demurrage_invoices').update({
    status: 'draft',
    billed_at: null,
    frozen_roe: null,
    frozen_total_brl: null,
    pix_payload: null,
    due_date: nextBusinessDay(),
  }).eq('id', invoiceId)
  if (error) throw error
}

export async function markInvoicePaid(invoiceId: number, paidAt: string, roe?: number | null): Promise<void> {
  const { data: inv, error: fetchErr } = await supabase
    .from('demurrage_invoices')
    .select('status, frozen_roe, frozen_total_brl, total_usd, discount_mode, discount_value, doc_number')
    .eq('id', invoiceId)
    .single()
  if (fetchErr) throw fetchErr

  let frozenRoe = inv.frozen_roe
  let frozenTotalBrl = inv.frozen_total_brl

  if (frozenRoe == null && roe != null) {
    frozenRoe = roe
    let totalBRL = inv.total_usd * roe
    if (inv.discount_value && inv.discount_value > 0) {
      if (inv.discount_mode === 'percent') totalBRL = totalBRL * (1 - inv.discount_value / 100)
      else totalBRL = Math.max(0, totalBRL - inv.discount_value)
    }
    frozenTotalBrl = parseFloat(totalBRL.toFixed(2))
  }

  const pix_payload = frozenTotalBrl && inv.doc_number ? buildTransshippingPixPayload(frozenTotalBrl, inv.doc_number) : undefined

  const { error } = await supabase.from('demurrage_invoices').update({
    status: 'paid',
    paid_at: paidAt,
    frozen_roe: frozenRoe,
    frozen_total_brl: frozenTotalBrl,
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

// ── DB: Invoice queries ───────────────────────────────────────

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

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as DemurrageInvoiceListItem[]
}

export async function getInvoiceDetail(invoiceId: number) {
  const [invRes, itemsRes] = await Promise.all([
    supabase.from('demurrage_invoices').select(`*, customer:customers(id,name,cnpj_cpf), bl:bls(id,pol,pod,voyage:voyages(id,voyage_number,vessel:vessels(id,name)))`).eq('id', invoiceId).single(),
    supabase.from('demurrage_invoice_items').select('*').eq('invoice_id', invoiceId).order('container_number'),
  ])
  if (invRes.error) throw invRes.error
  if (itemsRes.error) throw itemsRes.error
  return {
    invoice: invRes.data as unknown as DemurrageInvoiceListItem,
    items: (itemsRes.data ?? []) as unknown as DemurrageInvoiceItem[],
  }
}

export async function updateDemurrageInvoice(invoiceId: number, patch: Partial<Pick<DemurrageInvoice, 'discount_type' | 'discount_value' | 'discount_mode' | 'discount_justification' | 'discount_approver' | 'dispute_open' | 'dispute_subject' | 'dispute_reason' | 'dispute_status' | 'dispute_notes' | 'notes' | 'due_date' | 'roe' | 'roe_manual'>>): Promise<void> {
  const { error } = await supabase.from('demurrage_invoices').update(patch).eq('id', invoiceId)
  if (error) throw error
}

// ── PIX Reconciliation ────────────────────────────────────────

export function parsePixExtract(arrayBuffer: ArrayBuffer): PixTransaction[] {
  // Dynamically import XLSX — bundled via vite's import
  const XLSX = (window as unknown as { XLSX?: unknown }).XLSX as { read: (data: Uint8Array, opts: object) => { Sheets: Record<string, unknown>; SheetNames: string[] }; utils: { sheet_to_json: (sheet: unknown, opts: object) => unknown[][] } } | undefined
  if (!XLSX) throw new Error('XLSX não disponível. Adicione a lib ao projeto.')

  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', raw: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][]

  let headerRowIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((cell) => String(cell).toLowerCase().trim() === 'identificador')) {
      headerRowIdx = i
      break
    }
  }
  if (headerRowIdx === -1) throw new Error('Formato não reconhecido. Coluna "identificador" não encontrada.')

  const headers = rows[headerRowIdx].map((h) => String(h).toLowerCase().trim())
  const colId = headers.indexOf('identificador')
  const colCnpj = headers.findIndex((h) => h.includes('cpf') || h.includes('cnpj'))
  const colDate = headers.findIndex((h) => h.includes('pago em'))
  const colValue = headers.findIndex((h) => h.includes('valor pago'))

  if (colId === -1) throw new Error('Coluna "identificador" não encontrada.')
  if (colValue === -1) throw new Error('Coluna "valor pago" não encontrada.')

  const transactions: PixTransaction[] = []
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const txid = String(row[colId] ?? '').trim()
    if (!txid) continue

    let date = ''
    if (colDate >= 0) {
      const raw = String(row[colDate] ?? '').trim()
      const parts = raw.split('/')
      if (parts.length === 3) date = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
    }

    let amount = 0
    if (colValue >= 0) {
      amount = parseFloat(String(row[colValue] ?? '').trim().replace(/\./g, '').replace(',', '.')) || 0
    }
    if (amount <= 0) continue

    const cnpj = colCnpj >= 0 ? String(row[colCnpj] ?? '').trim() : ''
    transactions.push({ txid, cnpj, date, amount })
  }
  return transactions
}


// ── KPIs ──────────────────────────────────────────────────────

export type DemurrageKPIs = {
  overdueContainers: number
  draftInvoicesTotalUsd: number
  issuedInvoicesTotalBrl: number
}

export async function fetchDemurrageKPIs(): Promise<DemurrageKPIs> {
  const [contRes, draftRes, issuedRes] = await Promise.all([
    supabase.from('bl_containers').select('id', { count: 'exact', head: true }).eq('demurrage_status', 'overdue'),
    supabase.from('demurrage_invoices').select('total_usd').eq('status', 'draft'),
    supabase.from('demurrage_invoices').select('frozen_total_brl').eq('status', 'issued'),
  ])
  return {
    overdueContainers: contRes.count ?? 0,
    draftInvoicesTotalUsd: (draftRes.data ?? []).reduce((s, r) => s + (r.total_usd ?? 0), 0),
    issuedInvoicesTotalBrl: (issuedRes.data ?? []).reduce((s, r) => s + (r.frozen_total_brl ?? 0), 0),
  }
}

const ROE_CACHE_KEY = 'demurrage_roe_cache'

type RoeCache = { roe: number; fetchedAt: string }

function loadCachedROE(): RoeCache | null {
  try {
    const raw = localStorage.getItem(ROE_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as RoeCache
  } catch {
    return null
  }
}

function saveROECache(roe: number) {
  try {
    const payload: RoeCache = { roe, fetchedAt: new Date().toISOString() }
    localStorage.setItem(ROE_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage unavailable — ignore
  }
}

export type FetchROEResult = { roe: number; offline: boolean; cachedAt: string | null }

export async function fetchROE(): Promise<FetchROEResult> {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 10)
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`
  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial=%27${fmt(from)}%27&@dataFinalCotacao=%27${fmt(today)}%27&$top=1&$orderby=dataHoraCotacao%20desc&$format=json&$select=cotacaoVenda,dataHoraCotacao`

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!resp.ok) throw new Error(`BCB HTTP ${resp.status}`)
    const json = await resp.json()
    if (!json.value?.length || !json.value[0].cotacaoVenda) throw new Error('Sem cotações no BCB')
    const roe = parseFloat((parseFloat(json.value[0].cotacaoVenda) * 1.065).toFixed(4))
    saveROECache(roe)
    return { roe, offline: false, cachedAt: null }
  } catch {
    const cached = loadCachedROE()
    if (cached) return { roe: cached.roe, offline: true, cachedAt: cached.fetchedAt }
    throw new Error('BCB offline e sem cache de PTAX disponivel. Informe a taxa manualmente.')
  }
}
