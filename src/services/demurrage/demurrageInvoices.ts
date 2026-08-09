import { supabase } from '../supabase'
import { ensureDemurrageRatesLoaded, calculateDemurrage } from './demurrageRates'
import { buildTransshippingPixPayload } from '../../lib/pix'
import { extractErrorText } from '../../lib/errors'
import { fetchROE } from './demurrageKpis'
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

/**
 * Aplica o desconto da fatura de demurrage em USD, antes da conversão para BRL
 * (ADR 0014). Fonte única usada por todos os caminhos que congelam ou recalculam
 * o valor, evitando divergência entre eles. Percentual é limitado a 0–100 e o
 * valor fixo nunca leva o subtotal abaixo de zero.
 */
export function applyDemurrageUsdDiscount(
  totalUsd: number,
  discountMode: string | null | undefined,
  discountValue: number | null | undefined,
): number {
  let discounted = totalUsd ?? 0
  if (discountValue && discountValue > 0) {
    if (discountMode === 'percent') discounted = discounted * (1 - Math.min(100, discountValue) / 100)
    else discounted = Math.max(0, discounted - discountValue)
  }
  return discounted
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
  readyAt: string | null
  roeManual: boolean
  roe: number | null
  currentRoe: number
  roeSource: RoeSource
  items: DemurrageInvoiceItemSnapshot[]
}): Promise<number> {
  const { data, error } = await supabase.rpc('create_demurrage_invoice_with_items', {
    p_doc_number: input.docNumber,
    p_bl_id: input.blId,
    p_customer_id: input.customerId,
    p_total_usd: input.totalUsd,
    p_ready_at: input.readyAt,
    p_roe_manual: input.roeManual,
    p_roe: input.roe,
    p_current_roe: input.currentRoe,
    p_roe_source: input.roeSource,
    p_items: input.items,
  })
  if (error) {
    const text = extractErrorText(error).toLowerCase()
    if (text.includes('23505')) {
      throw new Error('Já existe fatura de Demurrage emitida ou paga para este B/L. Cancele a fatura atual antes de reemitir.')
    }
    throw error
  }

  const invoiceId = Number((data as { invoice_id?: number } | null)?.invoice_id)
  if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
    throw new Error('RPC de Demurrage nao retornou uma invoice valida.')
  }
  return invoiceId
}

/** ROE vigente para a foto inicial: override manual do B/L ou PTAX ao vivo do BCB. */
async function resolveCurrentRoe(roeManual: boolean, manualRoe: number | null): Promise<{ currentRoe: number; roeSource: RoeSource }> {
  if (roeManual && manualRoe && manualRoe > 0) return { currentRoe: manualRoe, roeSource: 'manual' }
  const { roe, source } = await fetchROE()
  return { currentRoe: roe, roeSource: source }
}

/**
 * Sob recálculo diário, uma fatura emitida e não paga não é sobrescrita pela
 * reimportação (ADR 0014). Detecta se já há fatura ativa (issued/paid) para o B/L.
 */
async function hasActiveInvoiceForBL(blId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('demurrage_invoices')
    .select('id')
    .eq('bl_id', blId)
    .in('status', ['issued', 'paid'])
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
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

  if (await hasActiveInvoiceForBL(blId)) {
    throw new Error('Já existe fatura de Demurrage emitida ou paga para este B/L. Cancele a fatura atual antes de reemitir.')
  }

  const total_usd = items.reduce((sum, i) => sum + i.calc.total_usd, 0)
  const doc_number = genDemurrageDocnum(blId)
  const ready_at = containers.every((c) => c.return_date) ? containers.reduce((max, c) => (c.return_date! > max ? c.return_date! : max), containers[0].return_date!) : null
  const { currentRoe, roeSource } = await resolveCurrentRoe(bl.demurrage_roe_manual ?? false, bl.demurrage_roe ?? null)

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
    readyAt: ready_at,
    roeManual: bl.demurrage_roe_manual ?? false,
    roe: bl.demurrage_roe ?? null,
    currentRoe,
    roeSource,
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

  // Reimportação para um B/L já com fatura ativa não sobrescreve (ADR 0014):
  // a fatura emitida/paga prevalece; a correção é cancelar + reemitir.
  if (await hasActiveInvoiceForBL(blId)) return null

  const total_usd = items.reduce((sum, i) => sum + i.calc.total_usd, 0)
  const doc_number = genDemurrageDocnum(blId)
  const ready_at = containers.reduce((max, c) => (c.return_date! > max ? c.return_date! : max), containers[0].return_date!)
  const { currentRoe, roeSource } = await resolveCurrentRoe(bl.demurrage_roe_manual ?? false, bl.demurrage_roe ?? null)

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
    readyAt: ready_at,
    roeManual: bl.demurrage_roe_manual ?? false,
    roe: bl.demurrage_roe ?? null,
    currentRoe,
    roeSource,
    items: itemRows,
  })
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
    // Desconto sempre em USD, antes da conversão para BRL (ADR 0014).
    const discountedUsd = applyDemurrageUsdDiscount(inv.total_usd ?? 0, inv.discount_mode, inv.discount_value)
    frozenTotalBrl = parseFloat((discountedUsd * roe).toFixed(2))
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

/**
 * Recalcula o current_total_brl e o QR PIX de uma fatura emitida e não paga após
 * mudança de desconto, aplicando o desconto em USD antes da conversão pelo ROE
 * vigente (ADR 0014). A foto de histórico do desconto é gravada no próximo
 * recálculo diário (Fase 1).
 */
export async function recomputeDiscountedBrl(invoiceId: number): Promise<void> {
  const { data: inv, error: fetchErr } = await supabase
    .from('demurrage_invoices')
    .select('total_usd, discount_mode, discount_value, current_roe, doc_number, status, paid_at')
    .eq('id', invoiceId)
    .single()
  if (fetchErr) throw fetchErr
  if (inv.status !== 'issued' || inv.paid_at != null || inv.current_roe == null) return

  const discountedUsd = applyDemurrageUsdDiscount(inv.total_usd ?? 0, inv.discount_mode, inv.discount_value)
  const totalBrl = parseFloat((discountedUsd * inv.current_roe).toFixed(2))
  const pix_payload = inv.doc_number ? buildTransshippingPixPayload(totalBrl, inv.doc_number) : undefined

  const { error } = await supabase.from('demurrage_invoices').update({
    current_total_brl: totalBrl,
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
    .select(`*, customer:customers(id,name,cnpj_cpf,address,city,state,zip), bl:bls(id,pol,pod,voyage:voyages(id,voyage_number,vessel:vessels(id,name)))`)
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
      .select(`*, customer:customers(id,name,cnpj_cpf,address,city,state,zip), bl:bls(id,pol,pod,voyage:voyages(id,voyage_number,vessel:vessels(id,name)))`)
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
