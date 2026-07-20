import { supabase } from './supabase'

export type ProvisioningDecision = 'aguardando_analise' | 'aprovado_para_provisionar' | 'provisionamento_nao_necessario'
export type AccountSituation = 'sem_conta' | 'convite_pendente' | 'convite_expirado' | 'falha_no_envio' | 'ativo' | 'suspenso'
export type RecoveryEmailSource = 'candidato' | 'informado_manualmente'
export type PortalDeliveryStatus = 'aceito' | 'entregue' | 'bounce' | 'complaint' | 'falha_transitoria' | 'falha_permanente'

export type PortalProvisioningRow = {
  account_id: number
  customer_id: number
  customer_name: string
  cnpj_cpf: string
  provisioning_decision: ProvisioningDecision
  account_situation: AccountSituation
  recovery_email: string | null
  recovery_email_source: RecoveryEmailSource | null
  pending_invite_expires_at: string | null
}

export type EmailCandidate = {
  email: string
  purpose: 'geral' | 'financeiro' | 'operacional' | 'faturamento'
  origin: string
}

export type QueueRow = PortalProvisioningRow & {
  hasCriticalAlert: boolean
  hasOpenInvoice: boolean
  hasActiveProcess: boolean
  lastActivityAt: string | null
  candidates: EmailCandidate[]
  sharedEmailCount: number
  latestDeliveryStatus: PortalDeliveryStatus | null
  exceptionReason: string | null
}

export type PortalProvisioningConsolePayload = {
  account_id: number
  customer_id: number
  customer_name: string
  cnpj_cpf: string
  provisioning_decision: ProvisioningDecision
  account_situation: AccountSituation
  recovery_email: string | null
  recovery_email_source: RecoveryEmailSource | null
  pending_invite_expires_at: string | null
  latest_delivery_status: PortalDeliveryStatus | null
  exception_reason: string | null
  last_event_at: string | null
  has_critical_alert: boolean
  has_open_invoice: boolean
  has_active_process: boolean
  candidates: EmailCandidate[]
  shared_email_count: number
}

export function effectiveSituation(situation: AccountSituation, pendingInviteExpiresAt: string | null): AccountSituation {
  if (situation === 'convite_pendente' && pendingInviteExpiresAt && new Date(pendingInviteExpiresAt).getTime() < Date.now()) return 'convite_expirado'
  return situation
}

export function comparePriority(a: QueueRow, b: QueueRow): number {
  const rank = (row: QueueRow): number => {
    if (row.provisioning_decision === 'provisionamento_nao_necessario') return 6
    if (row.hasCriticalAlert) return 0
    if (row.hasOpenInvoice) return 1
    if (row.hasActiveProcess) return 2
    if (row.lastActivityAt) return 3
    return 4
  }
  const difference = rank(a) - rank(b)
  if (difference !== 0) return difference
  return (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')
}

export async function listPortalProvisioningQueue(customerId?: number): Promise<QueueRow[]> {
  const { data, error } = await supabase.rpc(
    'portal_list_provisioning_console',
    customerId == null ? {} : { p_customer_id: customerId },
  )
  if (error) throw error
  return ((data ?? []) as unknown as PortalProvisioningConsolePayload[]).map((row) => ({
    account_id: row.account_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    cnpj_cpf: row.cnpj_cpf,
    provisioning_decision: row.provisioning_decision,
    account_situation: effectiveSituation(row.account_situation, row.pending_invite_expires_at),
    recovery_email: row.recovery_email,
    recovery_email_source: row.recovery_email_source,
    pending_invite_expires_at: row.pending_invite_expires_at,
    hasCriticalAlert: row.has_critical_alert,
    hasOpenInvoice: row.has_open_invoice,
    hasActiveProcess: row.has_active_process,
    lastActivityAt: row.last_event_at,
    candidates: row.candidates ?? [],
    sharedEmailCount: row.shared_email_count ?? 0,
    latestDeliveryStatus: row.latest_delivery_status,
    exceptionReason: row.exception_reason,
  })).sort(comparePriority)
}

export async function listPortalProvisioningEvents(customerId: number, limit = 10) {
  const { data, error } = await supabase.rpc('portal_list_provisioning_events', { p_customer_id: customerId, p_limit: limit })
  if (error) throw error
  return data ?? []
}

export async function setProvisioningException(customerId: number, reason: string) {
  const { error } = await supabase.rpc('portal_set_exception', { p_customer_id: customerId, p_reason: reason })
  if (error) throw error
}

export async function returnToAnalysis(customerId: number, reason: string) {
  const { error } = await supabase.rpc('portal_return_to_analysis', { p_customer_id: customerId, p_reason: reason })
  if (error) throw error
}
