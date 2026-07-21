import type { BL } from '../types/database'
import { INVOICE_STATUS_LABELS, statusLabel } from '../lib/statusLabels'
import { isCustomerReconciliationResolved } from './customerReconciliation'

export type RailState = 'done' | 'pending' | 'blocked' | 'diverted'

export type RailStage = {
  key: string
  label: string
  detail: string
  state: RailState
  href?: string
}

type RailBl = Pick<
  BL,
  'id' | 'voyage_id' | 'cargo_mode' | 'ce_mercante' | 'review_status'
  | 'customer_reconciliation_status' | 'customer_id' | 'charge_status' | 'financial_status'
>

export type RailContainer = { container_number: string; discharge_date: string | null; return_date: string | null }
export type RailSchedule = { etd?: string | null; atd?: string | null; eta?: string | null; ata?: string | null }
export type RailOmission = { omittedPod: string; dischargePod: string }
export type RailInvoice = { id: number; status: string | null; total_brl: number | null }
export type RailDemurrageInvoice = { id: number; status: string | null }

const fmt = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value)) : null

function distinct(containers: RailContainer[], has: (c: RailContainer) => boolean) {
  const all = new Set(containers.map((c) => c.container_number))
  const done = new Set(containers.filter(has).map((c) => c.container_number))
  return { done: done.size, total: all.size }
}

export function buildOperationalRail(input: {
  bl: RailBl
  polSchedule: RailSchedule | null
  podSchedule: RailSchedule | null
  containers: RailContainer[]
  omission: RailOmission | null
}): RailStage[] {
  const { bl, polSchedule, podSchedule, containers, omission } = input
  const voyageHref = bl.voyage_id ? `/viagens/${bl.voyage_id}` : undefined
  const pol: RailStage = polSchedule?.atd
    ? { key: 'pol', label: 'Saída do POL', detail: `ATD ${fmt(polSchedule.atd)}`, state: 'done', href: voyageHref }
    : { key: 'pol', label: 'Saída do POL', detail: polSchedule?.etd ? `ETD ${fmt(polSchedule.etd)}` : 'Sem previsão', state: 'pending', href: voyageHref }
  const pod: RailStage = omission
    ? { key: 'pod', label: 'Chegada ao POD', detail: `Omitida — descarga em ${omission.dischargePod}`, state: 'diverted', href: voyageHref }
    : podSchedule?.ata
      ? { key: 'pod', label: 'Chegada ao POD', detail: `ATA ${fmt(podSchedule.ata)}`, state: 'done', href: voyageHref }
      : { key: 'pod', label: 'Chegada ao POD', detail: podSchedule?.eta ? `ETA ${fmt(podSchedule.eta)}` : 'Sem previsão', state: 'pending', href: voyageHref }

  if (bl.cargo_mode !== 'container') return [pol, pod]
  const discharge = distinct(containers, (c) => Boolean(c.discharge_date))
  const returned = distinct(containers, (c) => Boolean(c.return_date))
  return [
    pol,
    pod,
    { key: 'discharge', label: 'Descarga', detail: discharge.total === 0 ? 'Sem containers' : `${discharge.done}/${discharge.total} descarregados`, state: discharge.total === 0 || discharge.done === discharge.total ? 'done' : 'pending', href: '/containers' },
    { key: 'return', label: 'Devolução', detail: returned.total === 0 ? 'Sem containers' : `${returned.done}/${returned.total} devolvidos`, state: returned.total === 0 || returned.done === returned.total ? 'done' : 'pending', href: `/manifestos/${bl.id}?tab=faturamento` },
  ]
}

export function buildFinancialRail(input: { bl: RailBl; latestInvoice: RailInvoice | null; demurrageInvoices: RailDemurrageInvoice[] }): RailStage[] {
  const { bl, latestInvoice, demurrageInvoices } = input
  const fichaFat = `/manifestos/${bl.id}?tab=faturamento`
  const fichaDet = `/manifestos/${bl.id}?tab=detalhes`
  const ce: RailStage = bl.ce_mercante
    ? { key: 'ce', label: 'CE Mercante', detail: bl.ce_mercante, state: 'done' }
    : { key: 'ce', label: 'CE Mercante', detail: 'Cadastrar CE', state: 'pending', href: fichaDet }
  const reviewOk = bl.review_status === 'reviewed' || bl.review_status === 'ok'
  const customerOk = isCustomerReconciliationResolved(bl.customer_reconciliation_status) && bl.customer_id != null
  const review: RailStage = reviewOk && customerOk
    ? { key: 'review', label: 'Revisão & Cliente', detail: 'OK', state: 'done' }
    : { key: 'review', label: 'Revisão & Cliente', detail: reviewOk ? 'Vincular cliente' : 'Revisar B/L', state: 'pending', href: reviewOk ? fichaFat : fichaDet }
  const chargesOk = bl.charge_status === 'ready_for_billing' || bl.charge_status === 'exempt'
  const charges: RailStage = chargesOk
    ? { key: 'charges', label: 'Taxas Locais', detail: bl.charge_status === 'exempt' ? 'Isento' : 'Pronto p/ faturar', state: 'done' }
    : { key: 'charges', label: 'Taxas Locais', detail: bl.charge_status === 'not_calculated' || !bl.charge_status ? 'Calcular taxas' : 'Revisar taxas', state: 'pending', href: fichaFat }
  const invoice: RailStage = latestInvoice
    ? { key: 'invoice', label: 'Fatura', detail: `#${latestInvoice.id} ${statusLabel(INVOICE_STATUS_LABELS, latestInvoice.status, '')}`.trim(), state: latestInvoice.status === 'cancelled' ? 'blocked' : 'done', href: `/faturamento?invoice=${latestInvoice.id}` }
    : { key: 'invoice', label: 'Fatura', detail: 'Não emitida', state: 'pending', href: fichaFat }
  const payment: RailStage = bl.financial_status === 'paid'
    ? { key: 'payment', label: 'Pagamento', detail: 'Pago', state: 'done' }
    : { key: 'payment', label: 'Pagamento', detail: 'Pendente', state: 'pending', href: '/faturamento' }
  const rail = [ce, review, charges, invoice, payment]
  if (demurrageInvoices.length > 0) {
    const allPaid = demurrageInvoices.every((d) => d.status === 'paid')
    rail.push({ key: 'demurrage', label: 'Demurrage', detail: `${demurrageInvoices.length} invoice(s)${allPaid ? ' pagas' : ''}`, state: allPaid ? 'done' : 'pending', href: fichaFat })
  }
  return rail
}

export function pickNextAction(financialRail: RailStage[]): RailStage | null {
  return financialRail.find((stage) => stage.state === 'pending' || stage.state === 'blocked') ?? null
}
