import { describe, expect, it, vi, beforeEach } from 'vitest'

const calls: { table: string; payload: unknown }[] = []
const mocks = vi.hoisted(() => ({
  reportBestEffortFailure: vi.fn(),
}))

vi.mock('../../../lib/telemetry', () => ({
  reportBestEffortFailure: mocks.reportBestEffortFailure,
}))

vi.mock('../../supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'bl_containers') {
        return {
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
          select: (columns: string) => ({
            eq: () => ({
              single: () => ({
                overrideTypes: () =>
                  Promise.resolve({
                    data: {
                      type: '20GP',
                      discharge_date: '2026-01-01',
                      return_date: columns === 'return_date' ? '2026-02-28' : '2026-02-20',
                      bl: null,
                    },
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      if (table === 'audit_logs') {
        return {
          insert: (payload: unknown) => {
            calls.push({ table, payload })
            return Promise.resolve({ error: null })
          },
        }
      }
      return {}
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
    },
  },
}))

vi.mock('../demurrageRates', () => ({
  ensureDemurrageRatesLoaded: vi.fn().mockResolvedValue(undefined),
  calculateDemurrage: vi.fn().mockReturnValue({ status: 'within_free_time', total_usd: 0, total_days: 14, free_days: 14 }),
}))

import { updateContainerReturnDate } from '../demurrageContainers'

describe('updateContainerReturnDate', () => {
  beforeEach(() => {
    calls.length = 0
    mocks.reportBestEffortFailure.mockClear()
  })

  it('writes an audit_logs row for the return-date change', async () => {
    await updateContainerReturnDate(42, '2026-03-01')
    const audit = calls.find((c) => c.table === 'audit_logs')
    expect(audit).toBeTruthy()
    expect(audit?.payload).toMatchObject({
      entity_type: 'bl_container',
      entity_id: '42',
      field_name: 'return_date',
      old_value: '2026-02-20',
      new_value: '2026-03-01',
    })
  })

  it('also audits clearing the return date (null)', async () => {
    await updateContainerReturnDate(42, null)
    const audit = calls.find((c) => c.table === 'audit_logs')
    expect(audit).toBeTruthy()
    expect(audit?.payload).toMatchObject({
      entity_type: 'bl_container',
      entity_id: '42',
      field_name: 'return_date',
      old_value: '2026-02-28',
      new_value: null,
    })
  })
})
