import { describe, expect, it } from 'vitest'
import { getBillingBlock, getBillingBlockReason, isAwaitingCeMercante, isBlLockedForRecalc, isPendingBillingReview, parseGateHoldReasons } from '../validacaoPipeline'

const base = { customer_reconciliation_status: 'matched_document', financial_status: 'pending', charge_status: 'calculated', review_status: null, notes: null, billing_hold_reason: null, customer_reconciliation_notes: null, charge_exemption_reason: null, ce_mercante: null as string | null, cargo_mode: 'container', customer: { id: 1 }, totals: { total_brl: 100, line_count: 1, review_required_count: 0 } }
describe('billing blocks', () => {
  it('classifica container calculado sem CE como aguardando_ce', () => expect(getBillingBlock(base).code).toBe('aguardando_ce'))
  it('classifica carga solta sem CE como pronta', () => expect(getBillingBlock({ ...base, cargo_mode: 'carga_solta' }).code).toBe('pronto'))
  it('classifica Granito como apoio operacional sem depender de CE', () => expect(getBillingBlock({ ...base, cargo_mode: 'granito' }).code).toBe('operacao_granito'))
  it('mantém Granito operacional mesmo quando há CE', () => expect(getBillingBlock({ ...base, cargo_mode: 'granito', ce_mercante: '122605051526081' }).code).toBe('operacao_granito'))
  it('prioriza causa estrutural sobre hold livre', () => expect(getBillingBlock({ ...base, customer: null, billing_hold_reason: 'texto livre' }).code).toBe('sem_cliente'))
  it('prioriza hold de cálculo sobre Aguardando CE', () => expect(getBillingBlock({ ...base, ce_mercante: null, billing_hold_reason: 'review:no_table' }).code).toBe('calculo_incompleto'))
  it('mantem o detalhe na API legada', () => expect(getBillingBlockReason({ ...base, review_status: 'pending_review', notes: 'Pendencias de importacao: Portal' })).toContain('Revis'))
  it('separa faturado e isento', () => { expect(getBillingBlock({ ...base, financial_status: 'invoiced' }).code).toBe('faturado'); expect(getBillingBlock({ ...base, charge_status: 'exempt' }).code).toBe('isento') })
})

// Gate de Portal (ADR 0054, migrations 337/367): a pendencia chega como
// billing_hold_reason do gate de revisao. Antes disso ela aparecia como
// "Calculo incompleto" — rotulo errado para um calculo que esta completo.
describe('bloqueio por portal não provisionado', () => {
  const withCe = { ...base, ce_mercante: '122605051526081' }
  const portalHold = 'B/L possui pendencias no gate de revisao: Acesso ao portal nao provisionado'

  it('nomeia o motivo quando o portal é a única pendência', () => {
    const block = getBillingBlock({ ...withCe, review_status: 'pending_review', billing_hold_reason: portalHold })
    expect(block.code).toBe('portal_nao_provisionado')
    expect(block.label).toBe('Portal não provisionado')
  })

  it('reconhece a pendência vinda das notas quando não há hold gravado', () => {
    const block = getBillingBlock({ ...withCe, review_status: 'pending_review', notes: 'Pendencias de importacao: Acesso ao portal nao provisionado' })
    expect(block.code).toBe('portal_nao_provisionado')
  })

  it('não trata como problema de cálculo: totais e linhas seguem íntegros', () => {
    const block = getBillingBlock({ ...withCe, review_status: 'pending_review', billing_hold_reason: portalHold })
    expect(block.code).not.toBe('calculo_incompleto')
  })

  it('cede a vez a pendências que não são do portal', () => {
    const block = getBillingBlock({
      ...withCe,
      review_status: 'pending_review',
      billing_hold_reason: 'B/L possui pendencias no gate de revisao: Cliente sem e-mail cadastrado, Acesso ao portal nao provisionado',
    })
    expect(block.code).toBe('calculo_incompleto')
  })

  it('fica atrás do CE Mercante na precedência', () => {
    const block = getBillingBlock({ ...base, ce_mercante: null, review_status: 'pending_review', billing_hold_reason: portalHold })
    expect(block.code).toBe('aguardando_ce')
  })

  it('fica atrás do cliente não vinculado', () => {
    const block = getBillingBlock({ ...withCe, customer: null, review_status: 'pending_review', billing_hold_reason: portalHold })
    expect(block.code).toBe('sem_cliente')
  })

  it('não bloqueia quem tem cálculo com linhas em revisão de verdade', () => {
    const block = getBillingBlock({ ...withCe, review_status: 'pending_review', billing_hold_reason: portalHold, totals: { total_brl: 100, line_count: 2, review_required_count: 1 } })
    expect(block.code).toBe('calculo_incompleto')
  })

  it('lê a lista de pendências do hold do gate', () => {
    expect(parseGateHoldReasons(portalHold)).toEqual(['Acesso ao portal nao provisionado'])
    expect(parseGateHoldReasons('texto livre')).toEqual([])
    expect(parseGateHoldReasons(null)).toEqual([])
  })
})
describe('legacy predicates', () => {
  it('reconhece revisão pendente', () => expect(isPendingBillingReview(base)).toBe(true))
  it('trava financeiros faturados', () => expect(isBlLockedForRecalc('invoiced')).toBe(true))
  it('reconhece aguardando CE', () => expect(isAwaitingCeMercante(base)).toBe(true))
  it('não conta Granito com CE no backlog de aguardando CE', () => expect(isAwaitingCeMercante({ ...base, cargo_mode: 'granito', ce_mercante: '122605051526081' })).toBe(false))
  it('não conta Granito sem CE no backlog de aguardando CE', () => expect(isAwaitingCeMercante({ ...base, cargo_mode: 'granito', ce_mercante: null })).toBe(false))
})
