import { beforeEach, expect, it, vi } from 'vitest'
import { listReconciliationHistory } from '../reconciliacao'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom },
}))

function localInvoice(id: number, blId: string) {
  return {
    id,
    invoice_number: `INV-${id}`,
    customer_id: 1,
    total_brl: 100,
    status: 'paid',
    invoice_type: 'individual',
    total_paid_brl: 100,
    balance_brl: 0,
    created_at: '2026-01-01T00:00:00Z',
    customer: { id: 1, name: 'Cliente', cnpj_cpf: '123' },
    invoice_bls: [{
      id,
      bl_id: blId,
      subtotal_brl: 100,
      bl: { pod: 'BRVIT', voyage: { voyage_number: 'V1', vessel: { name: 'Navio' } } },
    }],
    invoice_receivable_links: [],
    payments: [{ id, paid_at: '2026-01-01T10:00:00Z' }],
  }
}

beforeEach(() => {
  mockFrom.mockReset()
})

it('pagina toda a fonte antes de aplicar filtros do histórico', async () => {
  const firstLocalPage = Array.from({ length: 1000 }, (_, index) => localInvoice(index + 1, `OTHER-${index}`))
  const finalLocalPage = [localInvoice(2001, 'TARGET-BL')]
  const ranges = new Map<string, number>()

  mockFrom.mockImplementation((table: string) => {
    let start = 0
    const builder = {
      select: vi.fn(() => builder),
      in: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      range: vi.fn((from: number) => {
        start = from
        ranges.set(table, (ranges.get(table) ?? 0) + 1)
        return builder
      }),
      overrideTypes: vi.fn(() => builder),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: table === 'invoices'
          ? start === 0 ? firstLocalPage : finalLocalPage
          : [],
        error: null,
      }).then(resolve),
    }
    return builder
  })

  const result = await listReconciliationHistory({
    blSearch: 'TARGET',
    page: 1,
    pageSize: 50,
  })

  expect(result.rows).toHaveLength(1)
  expect(result.rows[0]?.blId).toBe('TARGET-BL')
  expect(ranges.get('invoices')).toBe(2)
})
