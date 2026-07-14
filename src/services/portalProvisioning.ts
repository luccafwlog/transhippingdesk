import { supabase } from './supabase'

const portalRpc = supabase.rpc as unknown as (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>

export type ProvisioningDecision = 'aguardando_analise' | 'aprovado_para_provisionar' | 'provisionamento_nao_necessario'
export type AccountSituation = 'sem_conta' | 'convite_pendente' | 'convite_expirado' | 'falha_no_envio' | 'ativo' | 'suspenso'

export type PortalProvisioningRow = {
  account_id: number
  customer_id: number
  customer_name: string
  cnpj_cpf: string
  provisioning_decision: ProvisioningDecision
  account_situation: AccountSituation
  recovery_email: string | null
  recovery_email_source: 'candidato' | 'informado_manualmente' | null
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
  sharedEmailCnpjs: string[]
}

type ProvisioningQueryRow = {
  id: number
  customer_id: number
  provisioning_decision: ProvisioningDecision
  account_situation: AccountSituation
  recovery_email: string | null
  recovery_email_source: 'candidato' | 'informado_manualmente' | null
  customers: { name?: string; cnpj_cpf?: string } | null
  portal_invites: Array<{ expires_at: string; status: string; purpose: string }> | null
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

export async function listPortalProvisioning(): Promise<PortalProvisioningRow[]> {
  const { data, error } = await supabase.from('customer_portal_accounts').select(`id, customer_id, provisioning_decision, account_situation, recovery_email, recovery_email_source, customers(name, cnpj_cpf), portal_invites(expires_at, status, purpose)`).order('customer_id')
  if (error) throw error
  return ((data ?? []) as unknown as ProvisioningQueryRow[]).map((row) => {
    const pending = (row.portal_invites ?? []).find((invite) => invite.status === 'pendente' && invite.purpose === 'convite')
    return {
      account_id: row.id,
      customer_id: row.customer_id,
      customer_name: row.customers?.name ?? '',
      cnpj_cpf: row.customers?.cnpj_cpf ?? '',
      provisioning_decision: row.provisioning_decision,
      account_situation: effectiveSituation(row.account_situation, pending?.expires_at ?? null),
      recovery_email: row.recovery_email,
      recovery_email_source: row.recovery_email_source,
      pending_invite_expires_at: pending?.expires_at ?? null,
    }
  })
}

export async function listPortalProvisioningQueue(): Promise<QueueRow[]> {
  const rows = await listPortalProvisioning()
  const enriched = await Promise.all(rows.map(async (row) => {
    const [{ data: contacts }, { data: alerts }] = await Promise.all([
      supabase.from('customer_contacts').select('email, purpose').eq('customer_id', row.customer_id).not('email', 'is', null),
      supabase.from('alerts').select('type, status, entity_type, entity_id, created_at').or(`entity_id.eq.${row.customer_id},entity_id.eq.${row.customer_id}`),
    ])
    const candidates = (contacts ?? []).flatMap((contact) => {
      const purpose = contact.purpose as EmailCandidate['purpose']
      return contact.email && ['geral', 'financeiro', 'operacional', 'faturamento'].includes(purpose)
        ? [{ email: contact.email, purpose, origin: 'Contato do Cliente' }]
        : []
    })
    const criticalTypes = new Set(['portal_excecao_critica_fatura', 'portal_convite_expirado', 'portal_falha_envio', 'portal_abuso_login'])
    return {
      ...row,
      hasCriticalAlert: (alerts ?? []).some((alert) => alert.status !== 'closed' && criticalTypes.has(alert.type)),
      hasOpenInvoice: (alerts ?? []).some((alert) => alert.status !== 'closed' && alert.type === 'portal_excecao_critica_fatura'),
      hasActiveProcess: false,
      lastActivityAt: (alerts ?? []).map((alert) => alert.created_at).filter(Boolean).sort().at(-1) ?? null,
      candidates,
      sharedEmailCnpjs: [],
    } satisfies QueueRow
  }))
  const byEmail = new Map<string, string[]>()
  for (const row of enriched) {
    if (!row.recovery_email) continue
    const key = row.recovery_email.toLowerCase()
    byEmail.set(key, [...(byEmail.get(key) ?? []), row.cnpj_cpf])
  }
  return enriched.map((row) => ({
    ...row,
    sharedEmailCnpjs: row.recovery_email ? (byEmail.get(row.recovery_email.toLowerCase()) ?? []).filter((cnpj) => cnpj !== row.cnpj_cpf) : [],
  })).sort(comparePriority)
}

export async function runPreflight() {
  const { data, error } = await portalRpc('portal_provisioning_preflight')
  if (error) throw error
  return data
}

export async function runBackfill(requestId: string) {
  const { data, error } = await portalRpc('portal_provisioning_backfill', { p_request_id: requestId })
  if (error) throw error
  return data
}

export async function setProvisioningException(customerId: number, reason: string) {
  const { error } = await portalRpc('portal_set_exception', { p_customer_id: customerId, p_reason: reason })
  if (error) throw error
}

export async function returnToAnalysis(customerId: number, reason: string) {
  const { error } = await portalRpc('portal_return_to_analysis', { p_customer_id: customerId, p_reason: reason })
  if (error) throw error
}
