import { beforeEach, expect, it, vi } from 'vitest'
import { fetchAuditLogs, fetchSystemMetrics } from '../adminObservability'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

function builder(result: { data: unknown; error: unknown; count?: number | null }) {
  const value = {
    select: vi.fn(() => value),
    order: vi.fn(() => value),
    limit: vi.fn(() => value),
    range: vi.fn(() => value),
    eq: vi.fn(() => value),
    gte: vi.fn(() => value),
    lte: vi.fn(() => value),
    in: vi.fn(() => value),
    then: (resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return value
}

beforeEach(() => {
  fromMock.mockReset()
})

it('propaga falha de qualquer leitura das metricas', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyages') return builder({ data: [], error: null })
    if (table === 'audit_logs') return builder({ data: null, error: new Error('audit unavailable') })
    if (table === 'invoices') return builder({ data: [], error: null })
    throw new Error(`Tabela inesperada: ${table}`)
  })

  await expect(fetchSystemMetrics()).rejects.toThrow('audit unavailable')
})

it('propaga falha ao resolver nomes dos autores do log', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'audit_logs') {
      return builder({
        data: [{
          id: 1,
          entity_type: 'bl',
          entity_id: 'BL-1',
          field_name: 'pod',
          old_value: 'A',
          new_value: 'B',
          changed_by: 'user-1',
          changed_at: '2026-06-23',
          justification: null,
        }],
        error: null,
        count: 1,
      })
    }
    if (table === 'user_profiles') return builder({ data: null, error: new Error('profiles unavailable') })
    throw new Error(`Tabela inesperada: ${table}`)
  })

  await expect(fetchAuditLogs({
    entityType: '',
    changedBy: '',
    dateFrom: '',
    dateTo: '',
    page: 0,
  })).rejects.toThrow('profiles unavailable')
})
