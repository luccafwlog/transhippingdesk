import { formatCnpjCpf, formatDate } from './utils'
import type { AccountSituation, PortalDeliveryStatus, ProvisioningDecision, QueueRow, RecoveryEmailSource, EmailCandidate } from '../services/portalProvisioning'

const DECISION_LABELS: Record<ProvisioningDecision, string> = {
  aguardando_analise: 'Aguardando análise',
  aprovado_para_provisionar: 'Provisionamento autorizado',
  provisionamento_nao_necessario: 'Provisionamento não necessário no momento',
}
const SITUATION_LABELS: Record<AccountSituation, string> = {
  sem_conta: 'Sem conta', convite_pendente: 'Ativação pendente', convite_expirado: 'Convite expirado',
  falha_no_envio: 'Falha no envio', ativo: 'Ativa', suspenso: 'Suspensa',
}
const SOURCE_LABELS: Record<RecoveryEmailSource, string> = {
  candidato: 'Candidato', informado_manualmente: 'Informado manualmente',
}
const PURPOSE_LABELS: Record<EmailCandidate['purpose'], string> = {
  geral: 'Geral', financeiro: 'Financeiro', operacional: 'Operacional', faturamento: 'Faturamento',
}
const DELIVERY_LABELS: Record<PortalDeliveryStatus, string> = {
  aceito: 'Aceito', entregue: 'Entregue', bounce: 'Devolvido', complaint: 'Reclamação',
  falha_transitoria: 'Falha temporária', falha_permanente: 'Falha permanente',
}

export function provisioningDecisionLabel(value: string | null | undefined) { return value && value in DECISION_LABELS ? DECISION_LABELS[value as ProvisioningDecision] : 'Não informado' }
export function accountSituationLabel(value: string | null | undefined) { return value && value in SITUATION_LABELS ? SITUATION_LABELS[value as AccountSituation] : 'Não informado' }
export function recoveryEmailSourceLabel(value: string | null | undefined) { return value && value in SOURCE_LABELS ? SOURCE_LABELS[value as RecoveryEmailSource] : 'Não informado' }
export function contactPurposeLabel(value: string | null | undefined) { return value && value in PURPOSE_LABELS ? PURPOSE_LABELS[value as EmailCandidate['purpose']] : 'Não informado' }
export function deliveryStatusLabel(value: string | null | undefined) { return value && value in DELIVERY_LABELS ? DELIVERY_LABELS[value as PortalDeliveryStatus] : 'Não informado' }

// Um cliente marcado como provisionamento_nao_necessario foi analisado e
// deliberadamente excluido do Portal — nao e uma pendencia (migration 190).
export function hasPortalPendency(row: Pick<QueueRow, 'account_situation' | 'provisioning_decision'> | null | undefined): boolean {
  if (!row) return false
  if (row.provisioning_decision === 'provisionamento_nao_necessario') return false
  return row.account_situation !== 'ativo'
}

export function getPortalNextAction(row: QueueRow): string {
  if (row.provisioning_decision === 'provisionamento_nao_necessario') return 'Reabrir análise'
  if (row.account_situation === 'convite_pendente') return 'Aguardar ativação'
  if (row.account_situation === 'convite_expirado') return 'Reenviar convite'
  if (row.account_situation === 'falha_no_envio') return row.recovery_email ? 'Revisar email e reenviar' : 'Revisar email'
  if (row.account_situation === 'ativo') return 'Conta ativa'
  if (row.account_situation === 'suspenso') return 'Reativar conta'
  if (row.provisioning_decision === 'aprovado_para_provisionar') return row.recovery_email ? 'Revisar e enviar' : 'Revisar email'
  return 'Revisar email'
}

export function formatPortalCandidate(candidate: EmailCandidate) {
  return `${candidate.email} · ${contactPurposeLabel(candidate.purpose)} · ${candidate.origin}`
}

export function portalProvisioningExportRow(row: QueueRow) {
  return {
    Cliente: row.customer_name,
    CNPJ: formatCnpjCpf(row.cnpj_cpf),
    Decisão: provisioningDecisionLabel(row.provisioning_decision),
    'Situação da conta': accountSituationLabel(row.account_situation),
    'Email de Recuperação': row.recovery_email ?? 'Não informado',
    'Origem do email': recoveryEmailSourceLabel(row.recovery_email_source),
    'Situação da entrega': deliveryStatusLabel(row.latestDeliveryStatus),
    'Vencimento do convite': row.pending_invite_expires_at ? formatDate(row.pending_invite_expires_at) : 'Não informado',
    'Alerta crítico': row.hasCriticalAlert ? 'Sim' : 'Não',
    'Última atividade': row.lastActivityAt ? formatDate(row.lastActivityAt) : 'Não informado',
    'Próxima ação': getPortalNextAction(row),
    'Email compartilhado': row.sharedEmailCount > 0 ? 'Sim' : 'Não',
  }
}
