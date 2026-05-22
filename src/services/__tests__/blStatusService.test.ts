import { describe, it, expect } from 'vitest'
import { getBlPipelineCards, type PipelineBL } from '../blStatusService'

function makeBl(overrides: Partial<PipelineBL> = {}): PipelineBL {
  return {
    review_status: null,
    customer_reconciliation_status: null,
    charge_status: null,
    financial_status: null,
    ...overrides,
  }
}

describe('getBlPipelineCards', () => {
  describe('revisão card', () => {
    it('verde quando reviewed', () => {
      const [card] = getBlPipelineCards(makeBl({ review_status: 'reviewed' }))
      expect(card.state).toBe('green')
      expect(card.href).toBeUndefined()
    })

    it('verde quando ok', () => {
      const [card] = getBlPipelineCards(makeBl({ review_status: 'ok' }))
      expect(card.state).toBe('green')
    })

    it('vermelho com link /revisao quando pendente', () => {
      const [card] = getBlPipelineCards(makeBl({ review_status: null }))
      expect(card.state).toBe('red')
      expect(card.href).toBe('/revisao')
    })
  })

  describe('cliente card', () => {
    it('verde quando reconciled', () => {
      const cards = getBlPipelineCards(makeBl({ customer_reconciliation_status: 'reconciled' }))
      expect(cards[1].state).toBe('green')
    })

    it('amarelo quando matched_document', () => {
      const cards = getBlPipelineCards(makeBl({ customer_reconciliation_status: 'matched_document' }))
      expect(cards[1].state).toBe('yellow')
    })

    it('vermelho quando missing_customer', () => {
      const cards = getBlPipelineCards(makeBl({ customer_reconciliation_status: 'missing_customer' }))
      expect(cards[1].state).toBe('red')
      expect(cards[1].href).toBe('/clientes')
    })

    it('vermelho quando rejected', () => {
      const cards = getBlPipelineCards(makeBl({ customer_reconciliation_status: 'rejected' }))
      expect(cards[1].state).toBe('red')
    })
  })

  describe('taxas card', () => {
    it('verde quando ready_for_billing', () => {
      const cards = getBlPipelineCards(makeBl({ charge_status: 'ready_for_billing' }))
      expect(cards[2].state).toBe('green')
    })

    it('verde quando exempt', () => {
      const cards = getBlPipelineCards(makeBl({ charge_status: 'exempt' }))
      expect(cards[2].state).toBe('green')
    })

    it('amarelo quando reviewed', () => {
      const cards = getBlPipelineCards(makeBl({ charge_status: 'reviewed' }))
      expect(cards[2].state).toBe('yellow')
    })

    it('amarelo quando calculated', () => {
      const cards = getBlPipelineCards(makeBl({ charge_status: 'calculated' }))
      expect(cards[2].state).toBe('yellow')
    })

    it('amarelo quando review_required', () => {
      const cards = getBlPipelineCards(makeBl({ charge_status: 'review_required' }))
      expect(cards[2].state).toBe('yellow')
    })

    it('vermelho quando não calculado', () => {
      const cards = getBlPipelineCards(makeBl({ charge_status: null }))
      expect(cards[2].state).toBe('red')
      expect(cards[2].href).toBe('/taxas-locais')
    })
  })

  describe('financeiro card', () => {
    it('verde quando paid', () => {
      const cards = getBlPipelineCards(makeBl({ financial_status: 'paid' }))
      expect(cards[3].state).toBe('green')
    })

    it('amarelo quando invoiced com link', () => {
      const cards = getBlPipelineCards(makeBl({ financial_status: 'invoiced' }))
      expect(cards[3].state).toBe('yellow')
      expect(cards[3].href).toBe('/faturamento')
    })

    it('vermelho quando cancelled', () => {
      const cards = getBlPipelineCards(makeBl({ financial_status: 'cancelled' }))
      expect(cards[3].state).toBe('red')
    })

    it('amarelo pendente quando null', () => {
      const cards = getBlPipelineCards(makeBl({ financial_status: null }))
      expect(cards[3].state).toBe('yellow')
    })
  })

  it('retorna sempre 4 cards', () => {
    expect(getBlPipelineCards(makeBl())).toHaveLength(4)
  })
})
