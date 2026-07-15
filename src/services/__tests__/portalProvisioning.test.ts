import { describe, expect, it } from 'vitest'
import { comparePriority, effectiveSituation, type QueueRow } from '../portalProvisioning'

function row(partial: Partial<QueueRow>): QueueRow {
  return {
    account_id: 1,
    customer_id: 1,
    customer_name: 'Cliente',
    cnpj_cpf: '12345678000195',
    provisioning_decision: 'aguardando_analise',
    account_situation: 'sem_conta',
    recovery_email: null,
    recovery_email_source: null,
    pending_invite_expires_at: null,
    hasCriticalAlert: false,
    hasOpenInvoice: false,
    hasActiveProcess: false,
    lastActivityAt: null,
    candidates: [],
    sharedEmailCnpjs: [],
    sharedEmailCount: 0,
    latestDeliveryStatus: null,
    exceptionReason: null,
    ...partial,
  }
}

describe('effectiveSituation', () => {
  it('rebaixa convite pendente vencido na leitura', () => {
    expect(effectiveSituation('convite_pendente', new Date(Date.now() - 60_000).toISOString())).toBe('convite_expirado')
  })
  it('mantém convite pendente dentro do prazo', () => {
    expect(effectiveSituation('convite_pendente', new Date(Date.now() + 60_000).toISOString())).toBe('convite_pendente')
  })
  it('não altera demais situações', () => {
    expect(effectiveSituation('ativo', null)).toBe('ativo')
    expect(effectiveSituation('sem_conta', null)).toBe('sem_conta')
  })
})

describe('comparePriority', () => {
  it('prioriza exceção crítica, fatura, processo e atividade nessa ordem', () => {
    expect(comparePriority(row({ hasCriticalAlert: true }), row({ hasOpenInvoice: true }))).toBeLessThan(0)
    expect(comparePriority(row({ hasOpenInvoice: true }), row({ hasActiveProcess: true }))).toBeLessThan(0)
    expect(comparePriority(row({ hasActiveProcess: true }), row({ lastActivityAt: '2026-07-01' }))).toBeLessThan(0)
  })

  it('mantém provisionamento não necessário por último', () => {
    expect(comparePriority(row({ provisioning_decision: 'provisionamento_nao_necessario', hasOpenInvoice: true }), row({}))).toBeGreaterThan(0)
  })
})
