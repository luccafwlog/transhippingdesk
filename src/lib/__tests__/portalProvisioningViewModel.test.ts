import { describe, expect, it } from 'vitest'
import { accountSituationLabel, contactPurposeLabel, deliveryStatusLabel, getPortalNextAction, provisioningDecisionLabel, recoveryEmailSourceLabel } from '../portalProvisioningViewModel'
import type { QueueRow } from '../../services/portalProvisioning'

const row = (partial: Partial<QueueRow> = {}): QueueRow => ({
  account_id: 1, customer_id: 1, customer_name: 'Cliente', cnpj_cpf: '12345678000195',
  provisioning_decision: 'aguardando_analise', account_situation: 'sem_conta', recovery_email: null,
  recovery_email_source: null, pending_invite_expires_at: null, hasCriticalAlert: false,
  hasOpenInvoice: false, hasActiveProcess: false, lastActivityAt: null, candidates: [],
  sharedEmailCnpjs: [], sharedEmailCount: 0, latestDeliveryStatus: null, exceptionReason: null, ...partial,
})

describe('portalProvisioningViewModel', () => {
  it('traduz todos os valores canônicos', () => {
    expect(provisioningDecisionLabel('aprovado_para_provisionar')).toBe('Provisionamento autorizado')
    expect(accountSituationLabel('convite_pendente')).toBe('Ativação pendente')
    expect(accountSituationLabel('ativo')).toBe('Ativa')
    expect(recoveryEmailSourceLabel('informado_manualmente')).toBe('Informado manualmente')
    expect(contactPurposeLabel('faturamento')).toBe('Faturamento')
    expect(deliveryStatusLabel('entregue')).toBe('Entregue')
    expect(accountSituationLabel('valor_inesperado')).toBe('Não informado')
  })
  it('deriva a próxima ação sem expor enum', () => {
    expect(getPortalNextAction(row({ account_situation: 'convite_expirado' }))).toBe('Reenviar convite')
    expect(getPortalNextAction(row({ provisioning_decision: 'provisionamento_nao_necessario' }))).toBe('Reabrir análise')
  })
})
