import { describe, expect, it, vi, beforeEach } from 'vitest'

const calls: { table: string; payload: unknown }[] = []

vi.mock('../../supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'bl_containers') {
        return {
          update: (_payload: unknown) => ({
            eq: () => Promise.resolve({ error: null }),
          }),
          select: () => ({
            eq: () => ({
              single: () => ({
                overrideTypes: () =>
                  Promise.resolve({
                    data: {
                      type: '20GP',
                      discharge_date: '2026-01-01',
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
  })

  it('writes an audit_logs row for the return-date change', async () => {
    await updateContainerReturnDate(42, '2026-03-01')
    const audit = calls.find((c) => c.table === 'audit_logs')
    expect(audit).toBeTruthy()
    expect(audit?.payload).toMatchObject({
      entity_type: 'bl_container',
      entity_id: '42',
      field_name: 'return_date',
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
      new_value: null,
    })
  })
})
