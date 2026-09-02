import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFrom, mockRpc, queryCalls } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  queryCalls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))

vi.mock('../supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }))

import { fetchDemurrageDunningStatuses } from '../demurrageDunning'

function queryResult(table: string, data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[method] = vi.fn((...args: unknown[]) => {
      queryCalls.push({ table, method, args })
      return chain
    })
  }
  chain.maybeSingle = vi.fn(async () => ({ data, error }))
  chain.overrideTypes = vi.fn(() => Promise.resolve({ data, error }))
  chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data, error }).then(resolve)
  return chain
}

describe('leitura da régua de Demurrage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryCalls.length = 0
    mockRpc.mockImplementation((name: string) => {
      expect(name).toBe('list_demurrage_dunning_claim_statuses')
      return queryResult('rpc:list_demurrage_dunning_claim_statuses', [{
        invoice_id: 1,
        attempt_count: 2,
        last_attempt_at: '2026-09-01T10:00:00Z',
      }])
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'customer_contacts') return queryResult(table, [{ id: 11, customer_id: 10, email: 'Finance@Example.com' }])
      if (table === 'app_settings') return queryResult(table, { demurrage_dunning_interval_days: 5 })
      if (table === 'customer_contact_preferences') return queryResult(table, [{ contact_id: 11, nature: 'demurrage', enabled: true }])
      if (table === 'customer_communication_suppressions' || table === 'portal_suppressed_emails') return queryResult(table, [])
      throw new Error(`tabela inesperada: ${table}`)
    })
  })

  it('usa claims ativos para o contador e limita consultas de contatos ao escopo carregado', async () => {
    const result = await fetchDemurrageDunningStatuses([{ id: 1, customer_id: 10 }])

    expect(result.get(1)).toMatchObject({
      attemptCount: 2,
      lastAttemptAt: '2026-09-01T10:00:00Z',
      hasValidContact: true,
      intervalDays: 5,
    })
    expect(mockRpc).toHaveBeenCalledWith('list_demurrage_dunning_claim_statuses', { p_invoice_ids: [1] })
    expect(queryCalls).toContainEqual({ table: 'customer_contact_preferences', method: 'in', args: ['contact_id', [11]] })
    expect(queryCalls).toContainEqual({
      table: 'customer_communication_suppressions',
      method: 'in',
      args: ['email', ['Finance@Example.com', 'finance@example.com']],
    })
    expect(queryCalls.some((call) => call.table === 'customer_communications')).toBe(false)
  })
})
