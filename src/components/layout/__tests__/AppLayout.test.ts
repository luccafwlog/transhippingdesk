import { describe, expect, it } from 'vitest'
import { buildFinancialNavItemsForCounts, getNavIndicator } from '../AppLayout'

describe('financial navigation badges', () => {
  it('prioriza Faturamento e usa alerta booleano para pendencias de faturamento', () => {
    const items = buildFinancialNavItemsForCounts({
      pendingReview: 0,
      chargeReviewRequired: 3,
      readyForBilling: 12,
      openAlerts: 0,
      blsWithoutCustomer: 0,
    })

    expect(items.slice(0, 2).map((item) => item.to)).toEqual(['/faturamento', '/taxas-locais'])
    expect(items.find((item) => item.to === '/faturamento')).toMatchObject({ alert: true })
    expect(items.find((item) => item.to === '/faturamento')?.badge).toBeUndefined()
    expect(items.find((item) => item.to === '/taxas-locais')?.badge).toBe(3)
    expect(getNavIndicator(items)).toEqual({ type: 'alert' })
  })
})
