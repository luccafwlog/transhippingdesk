import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  ensureRates: vi.fn(),
  calculate: vi.fn(),
  fetchROE: vi.fn(),
}))

vi.mock('../../supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}))
vi.mock('../demurrageRates', () => ({
  ensureDemurrageRatesLoaded: mocks.ensureRates,
  calculateDemurrage: mocks.calculate,
}))
vi.mock('../demurrageKpis', () => ({
  fetchROE: mocks.fetchROE,
}))

import { createInvoiceForBL } from '../demurrageInvoices'

function singleQuery(result: unknown) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(result),
      })),
    })),
  }
}

function listQuery(result: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.in.mockReturnValue(builder)
  builder.limit.mockReturnValue(builder)
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensureRates.mockResolvedValue(undefined)
  mocks.fetchROE.mockResolvedValue({ roe: 5.5, offline: false, cachedAt: null, source: 'bcb_live' })
  mocks.calculate.mockReturnValue({
    total_days: 12,
    free_days: 7,
    days_p1: 5,
    rate_p1_usd: 100,
    days_p2: 0,
    rate_p2_usd: 200,
    total_usd: 500,
  })

  mocks.from.mockImplementation((table: string) => {
    if (table === 'bls') {
      return singleQuery({
        data: {
          id: 'BL-1',
          customer_id: 9,
          free_time_override: null,
          demurrage_rate_override_p1_usd: null,
          demurrage_rate_override_p2_usd: null,
          demurrage_roe_manual: false,
          demurrage_roe: null,
        },
        error: null,
      })
    }
    if (table === 'bl_containers') {
      return listQuery({
        data: [{
          id: 4,
          container_number: 'ABCD1234567',
          type: '40HC',
          discharge_date: '2026-06-01',
          return_date: '2026-06-13',
          demurrage_status: 'overdue',
        }],
        error: null,
      })
    }
    if (table === 'demurrage_invoices') {
      // Guard de duplicidade: nenhuma fatura ativa para o B/L.
      return listQuery({ data: [], error: null }) as unknown as Record<string, unknown>
    }
    throw new Error(`Unexpected table: ${table}`)
  })
  mocks.rpc.mockResolvedValue({ data: { invoice_id: 321 }, error: null })
})

describe('atomic Demurrage invoice creation', () => {
  it('persists the header and item snapshot through one RPC', async () => {
    const invoiceId = await createInvoiceForBL('BL-1')

    expect(mocks.rpc).toHaveBeenCalledWith('create_demurrage_invoice_with_items', expect.objectContaining({
      p_bl_id: 'BL-1',
      p_customer_id: 9,
      p_total_usd: 500,
      p_ready_at: '2026-06-13',
      p_current_roe: 5.5,
      p_roe_source: 'bcb_live',
      p_items: [{
        container_id: 4,
        container_number: 'ABCD1234567',
        container_type: '40HC',
        discharge_date: '2026-06-01',
        return_date: '2026-06-13',
        total_days: 12,
        free_days: 7,
        days_p1: 5,
        rate_p1_usd: 100,
        days_p2: 0,
        rate_p2_usd: 200,
        subtotal_usd: 500,
      }],
    }))
    expect(invoiceId).toBe(321)
  })

  it('maps database uniqueness violations to the friendly duplicate invoice message', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })

    await expect(createInvoiceForBL('BL-1')).rejects.toThrow('Já existe fatura de Demurrage emitida ou paga para este B/L. Cancele a fatura atual antes de reemitir.')
  })
})
