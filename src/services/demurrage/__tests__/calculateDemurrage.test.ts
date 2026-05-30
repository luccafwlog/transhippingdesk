import { describe, expect, it, vi } from 'vitest'

// calculateDemurrage só usa as tarifas estáticas quando nenhuma tarifa dinâmica
// foi carregada do banco — então o cliente Supabase nunca é tocado aqui.
vi.mock('../../supabase', () => ({ supabase: {} }))

import { calculateDemurrage } from '../demurrageRates'

// Sem dados dinâmicos carregados, calculateDemurrage usa STATIC_RATE_GROUPS.
// 20GP: free 21d · P1 [22,30]@30 USD/d · P2 [31,∞]@50 USD/d
// 40GP: free 21d · P1 [22,30]@60 USD/d · P2 [31,∞]@80 USD/d
// 20RF: free 10d · P1 [11,19]@95 USD/d · P2 [20,∞]@110 USD/d

describe('calculateDemurrage', () => {
  it('dentro do free time não gera cobrança', () => {
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-15') // 14 dias
    expect(r.total_days).toBe(14)
    expect(r.status).toBe('within_free_time')
    expect(r.total_usd).toBe(0)
    expect(r.free_days).toBe(14)
  })

  it('exatamente no limite do free time ainda é gratuito', () => {
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-22') // 21 dias
    expect(r.total_days).toBe(21)
    expect(r.status).toBe('within_free_time')
    expect(r.total_usd).toBe(0)
  })

  it('cobra apenas dias do período 1', () => {
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-26') // 25 dias
    expect(r.total_days).toBe(25)
    expect(r.status).toBe('overdue')
    expect(r.days_p1).toBe(4) // dias 22..25
    expect(r.days_p2).toBe(0)
    expect(r.total_usd).toBe(4 * 30)
    expect(r.free_days).toBe(21)
  })

  it('cobra períodos 1 e 2 combinados', () => {
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-02-05') // 35 dias
    expect(r.total_days).toBe(35)
    expect(r.days_p1).toBe(9) // dias 22..30
    expect(r.days_p2).toBe(5) // dias 31..35
    expect(r.total_usd).toBe(9 * 30 + 5 * 50)
  })

  it('aplica tabela específica por tipo de container (40GP)', () => {
    const r = calculateDemurrage('40GP', '2026-01-01', '2026-01-26') // 25 dias
    expect(r.days_p1).toBe(4)
    expect(r.total_usd).toBe(4 * 60)
  })

  it('reefer tem free time menor (20RF: 10 dias)', () => {
    const r = calculateDemurrage('20RF', '2026-01-01', '2026-01-13') // 12 dias
    expect(r.status).toBe('overdue')
    expect(r.free_days).toBe(10)
    expect(r.days_p1).toBe(2) // dias 11..12
    expect(r.total_usd).toBe(2 * 95)
  })

  it('tipo desconhecido cai na tabela padrão (20GP)', () => {
    const r = calculateDemurrage('XXX9', '2026-01-01', '2026-01-26')
    expect(r.total_usd).toBe(4 * 30)
  })

  it('override de free time desloca as faixas', () => {
    // free 25 → P1 passa a [26,34]
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-29', 25) // 28 dias
    expect(r.free_days).toBe(25)
    expect(r.days_p1).toBe(3) // dias 26..28
    expect(r.total_usd).toBe(3 * 30)
  })

  it('override de tarifa por dia (ov1) é aplicado', () => {
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-26', null, 100)
    expect(r.days_p1).toBe(4)
    expect(r.rate_p1_usd).toBe(100)
    expect(r.total_usd).toBe(4 * 100)
  })

  it('rejeita datas inválidas', () => {
    expect(() => calculateDemurrage('20GP', '', '2026-01-10')).toThrow()
    expect(() => calculateDemurrage('20GP', '2026-01-01', 'nao-e-data')).toThrow()
  })
})
