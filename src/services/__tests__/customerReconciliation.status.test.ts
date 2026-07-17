import { expect, it } from 'vitest'
import { isCustomerReconciliationResolved } from '../customerReconciliation'

it('only treats document match and explicit reconciliation as billing-safe', () => {
  expect(isCustomerReconciliationResolved('matched_document')).toBe(true)
  expect(isCustomerReconciliationResolved('reconciled')).toBe(true)
  expect(isCustomerReconciliationResolved('matched_name')).toBe(false)
  expect(isCustomerReconciliationResolved('pending')).toBe(false)
  expect(isCustomerReconciliationResolved(null)).toBe(false)
})
