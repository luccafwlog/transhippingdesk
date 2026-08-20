import { expect, it } from 'vitest'
import { queryKeys } from '../queryKeys'

it('provides true prefix keys for filtered local-charge queries', () => {
  expect(queryKeys.charges.tables()).toEqual(['local-charge-tables'])
  expect(queryKeys.charges.overrides()).toEqual(['local-charge-overrides'])
  expect(queryKeys.reconciliation.queue()).toEqual(['customer-reconciliation-queue'])
  expect(queryKeys.bls.detail()).toEqual(['bl-detail'])
  expect(queryKeys.bls.timeline()).toEqual(['bl-timeline'])
  expect(queryKeys.bls.localChargeLines()).toEqual(['bl-local-charge-lines'])
  expect(queryKeys.bls.manualChargeItems()).toEqual(['manual-charge-items'])
})
