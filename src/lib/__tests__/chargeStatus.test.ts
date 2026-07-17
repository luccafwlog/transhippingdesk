import { describe, expect, it } from 'vitest'
import { isChargeExempt, isChargePending, isChargeReady, summarizeChargeStatuses } from '../chargeStatus'

describe('chargeStatus', () => {
  it('agrupa pendente / pronto / isento', () => {
    const rows = [
      { charge_status: 'review_required' },
      { charge_status: 'not_calculated' },
      { charge_status: 'ready_for_billing' },
      { charge_status: 'exempt' },
      { charge_status: 'calculated' },
      { charge_status: null },
    ]
    expect(summarizeChargeStatuses(rows)).toEqual({ pending: 2, ready: 1, exempt: 1 })
  })

  it('predicados não se sobrepõem', () => {
    for (const status of ['not_calculated', 'calculated', 'review_required', 'reviewed', 'ready_for_billing', 'exempt']) {
      const hits = [isChargePending(status), isChargeReady(status), isChargeExempt(status)].filter(Boolean)
      expect(hits.length).toBeLessThanOrEqual(1)
    }
  })
})
