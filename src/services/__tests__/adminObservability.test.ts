import { beforeEach, expect, it, vi } from 'vitest'
import { fetchAuditLogs, fetchSystemMetrics } from '../adminObservability'

const { fromMock, supabaseMock } = vi.hoisted(() => {
  const supabaseMock = { from: vi.fn() }
  return { fromMock: supabaseMock.from, supabaseMock }
})
vi.mock('../supabase', () => ({ supabase: supabaseMock }))

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

it('mantém o cliente Supabase ligado ao builder de falhas de roteamento', async () => {
  const result = builder({
    data: [{
      id: 7,
      alert_id: 11,
      alert_item_id: 12,
      event_id: 13,
      item_type: 'invoice_overdue',
      department: 'documentacao',
      reason: 'sem destinatário',
      created_at: '2026-08-22T10:00:00Z',
      alert: { entity_type: 'invoice', entity_id: 'INV-7' },
    }],
    error: null,
    count: 1,
  })

  fromMock.mockImplementation(function (this: unknown, table: string) {
    expect(this).toBe(supabaseMock)
    expect(table).toBe('alert_notification_failures')
    return result
  })

  const response = await (await import('../adminObservability')).fetchRoutingFailures()

  expect(response).toEqual({
    count: 1,
    rows: [expect.objectContaining({ id: 7, entity_type: 'invoice', entity_id: 'INV-7' })],
  })
})
