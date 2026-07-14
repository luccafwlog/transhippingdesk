import { supabase } from './supabase'

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

export async function runPreflight() {
  const { data, error } = await supabase.rpc('portal_provisioning_preflight')
  if (error) throw error
  return data
}

export async function runBackfill(requestId: string) {
  const { data, error } = await supabase.rpc('portal_provisioning_backfill', { p_request_id: requestId })
  if (error) throw error
  return data
}

export async function setProvisioningException(customerId: number, reason: string) {
  const { error } = await supabase.rpc('portal_set_exception', { p_customer_id: customerId, p_reason: reason })
  if (error) throw error
}

export async function returnToAnalysis(customerId: number, reason: string) {
  const { error } = await supabase.rpc('portal_return_to_analysis', { p_customer_id: customerId, p_reason: reason })
  if (error) throw error
}
