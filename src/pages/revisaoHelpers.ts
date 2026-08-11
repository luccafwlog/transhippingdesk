// Predicados puros para a fila de revisão.
import { onlyDigits } from '../lib/utils'
import type { ReviewQueueItem } from '../hooks/useReview'

export function normalizeConsignee(value?: string | null) {
  return value?.trim() || ''
}

// Cliente e consignatário são a mesma entidade, chaveada por CNPJ. Se o CNPJ já
// está cadastrado, vale a razão social do cliente; senão, vale o dado do
// manifesto (que pode ter ruído de leitura). Por isso o CNPJ do cliente
// vinculado tem prioridade sobre o CNPJ lido do manifesto.
export function getReviewItemCnpj(item: ReviewQueueItem): string | null {
  const registered = item.customer?.cnpj_cpf ? onlyDigits(item.customer.cnpj_cpf) : ''
  if (registered) return registered
  const manifest = item.manifest_customer_cnpj_cpf ? onlyDigits(item.manifest_customer_cnpj_cpf) : ''
  return manifest || null
}

export function getReviewItemDisplayName(item: ReviewQueueItem): string {
  if (item.customer?.name) return item.customer.name
  return (
    normalizeConsignee(item.consignee) ||
    normalizeConsignee(item.shipper) ||
    (item.source === 'granite' ? item.bl_number : item.id)
  )
}

export type ReviewGroup = {
  key: string
  cnpj: string | null
  displayName: string
  items: ReviewQueueItem[]
}

// Chave de grupo: CNPJ quando existe; senão, nome de exibição normalizado.
export function getReviewItemGroupKey(item: ReviewQueueItem): string {
  const cnpj = getReviewItemCnpj(item)
  return cnpj ? `cnpj:${cnpj}` : `name:${getReviewItemDisplayName(item).toLowerCase()}`
}

// Agrupa a fila por cliente/consignatário usando o CNPJ como chave. Itens sem
// CNPJ caem em um grupo por nome normalizado. Mantém a ordem alfabética por
// nome de exibição para a fila ficar previsível.
export function groupReviewItems(items: ReviewQueueItem[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>()
  for (const item of items) {
    const cnpj = getReviewItemCnpj(item)
    const displayName = getReviewItemDisplayName(item)
    const key = getReviewItemGroupKey(item)
    let group = groups.get(key)
    if (!group) {
      group = { key, cnpj, displayName, items: [] }
      groups.set(key, group)
    }
    group.items.push(item)
    // Prefere a razão social cadastrada como nome do grupo.
    if (item.customer?.name) group.displayName = item.customer.name
  }
  return Array.from(groups.values()).sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export function getConsigneeFilterOptions(items: ReviewQueueItem[]) {
  return Array.from(new Set(items.map((item) => normalizeConsignee(item.consignee)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  )
}

export function getSelectionConsignee(items: ReviewQueueItem[]) {
  const normalized = items.map((item) => normalizeConsignee(item.consignee))
  if (normalized.some((consignee) => !consignee)) return null
  const consignees = new Set(normalized)
  return consignees.size === 1 ? [...consignees][0] : null
}

export function needsCustomerLink(item: ReviewQueueItem) {
  return item.customer_id == null
}

export function customerHasEmail(item: ReviewQueueItem) {
  return Boolean(item.customer?.customer_contacts?.some((contact) => (contact.email ?? '').trim()))
}

// O cliente de um grupo: primeiro item ja vinculado (todos compartilham o CNPJ).
export function getGroupLinkedItem(group: ReviewGroup) {
  return group.items.find((item) => item.customer?.id != null) ?? null
}

function groupHasReviewReason(group: ReviewGroup, pattern: RegExp) {
  return group.items.some((item) =>
    (item.review_reasons ?? []).some((reason) => pattern.test(reason)),
  )
}

// As travas de nivel-cliente vêm das pendencias canonicas calculadas pelo banco.
// Isso evita inferir portal pela relacao protegida por RLS e mantem a UI alinhada
// ao mesmo estado que decide review_status e faturamento.
export function groupNeedsEmail(group: ReviewGroup) {
  const linked = getGroupLinkedItem(group)
  return Boolean(linked) && groupHasReviewReason(group, /cliente sem e-mail cadastrado/i)
}

// Mantidos por compatibilidade com consumidores legados; a fila principal nao
// os usa para decidir faturamento ou vinculo.
export function groupNeedsPortal(group: ReviewGroup) {
  const linked = getGroupLinkedItem(group)
  return Boolean(linked) && groupHasReviewReason(group, /acesso ao portal nao provisionado/i)
}

export function needsCeMercante(item: ReviewQueueItem) {
  if (item.source !== 'bl') return false
  return (item.review_reasons ?? []).some((reason) => /ce\s*mercante/i.test(reason))
}

export function needsWeightFix(item: ReviewQueueItem) {
  if (item.source !== 'bl') return false
  if ((item.review_reasons ?? []).some((reason) => /weight ton|peso bb/i.test(reason))) return true
  // Carga solta (BB) sem peso em toneladas: o calculo de taxas exige bb_weight_ton.
  return item.cargo_mode === 'carga_solta' && (item.bb_weight_ton == null || Number(item.bb_weight_ton) <= 0)
}
