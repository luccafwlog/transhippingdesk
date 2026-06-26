import { describe, expect, it, vi } from 'vitest'

// O helper é pura aritmética; o cliente Supabase nunca é tocado.
vi.mock('../../supabase', () => ({ supabase: {} }))
vi.mock('../../../lib/pix', () => ({ buildTransshippingPixPayload: () => undefined }))

import { applyDemurrageUsdDiscount } from '../demurrageInvoices'

describe('applyDemurrageUsdDiscount', () => {
  it('sem desconto retorna o total integral', () => {
    expect(applyDemurrageUsdDiscount(1000, null, null)).toBe(1000)
    expect(applyDemurrageUsdDiscount(1000, 'percent', 0)).toBe(1000)
    expect(applyDemurrageUsdDiscount(1000, 'fixed', null)).toBe(1000)
  })

  it('aplica desconto percentual', () => {
    expect(applyDemurrageUsdDiscount(1000, 'percent', 10)).toBe(900)
    expect(applyDemurrageUsdDiscount(1000, 'percent', 25)).toBe(750)
  })

  it('limita o percentual a 100 (nunca negativo)', () => {
    expect(applyDemurrageUsdDiscount(1000, 'percent', 150)).toBe(0)
  })

  it('aplica desconto fixo em USD', () => {
    expect(applyDemurrageUsdDiscount(1000, 'fixed', 250)).toBe(750)
  })

  it('desconto fixo nunca leva abaixo de zero', () => {
    expect(applyDemurrageUsdDiscount(1000, 'fixed', 1500)).toBe(0)
  })

  it('ignora valores de desconto não positivos', () => {
    expect(applyDemurrageUsdDiscount(1000, 'fixed', -50)).toBe(1000)
    expect(applyDemurrageUsdDiscount(1000, 'percent', -10)).toBe(1000)
  })
})
