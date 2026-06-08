import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCustomerReport, fetchFinancialReport } from '../reports'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}))

function createBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    not: vi.fn(() => builder),
    in: vi.fn(() => builder),
    overrideTypes: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

function installReportMocks(input: {
  bls?: unknown[]
  invoices?: unknown[]
  links?: unknown[]
}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bls') return createBuilder({ data: input.bls ?? [], error: null })
    if (table === 'invoices') return createBuilder({ data: input.invoices ?? [], error: null })
    if (table === 'invoice_receivable_links') return createBuilder({ data: input.links ?? [], error: null })
    throw new Error(`Tabela nao mockada: ${table}`)
  })
}

describe('reports receivable-backed balances', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('deduplica saldo financeiro aberto por receivable mesmo com individual e consolidada', async () => {
    installReportMocks({
      invoices: [
        {
          id: 1,
          invoice_number: 'INV-1',
          invoice_type: 'individual',
          status: 'issued',
          total_brl: 100,
          balance_brl: 100,
          issued_at: '2026-05-20',
          due_date: '2026-05-30',
          created_at: '2026-05-20',
          customer: { id: 10, name: 'Cliente Alfa', cnpj_cpf: '12345678000195' },
        },
        {
          id: 2,
          invoice_number: 'INV-2',
          invoice_type: 'consolidated',
          status: 'issued',
          total_brl: 100,
          balance_brl: 100,
          issued_at: '2026-05-21',
          due_date: '2026-05-31',
          created_at: '2026-05-21',
          customer: { id: 10, name: 'Cliente Alfa', cnpj_cpf: '12345678000195' },
        },
        {
          id: 3,
          invoice_number: 'GR-1',
          invoice_type: 'granite',
          status: 'issued',
          total_brl: 40,
          balance_brl: 40,
          issued_at: '2026-05-22',
          due_date: '2026-06-01',
          created_at: '2026-05-22',
          customer: { id: 10, name: 'Cliente Alfa', cnpj_cpf: '12345678000195' },
        },
      ],
      links: [
        {
          invoice_id: 1,
          receivable_id: 99,
          status: 'active',
          receivable: { id: 99, original_amount_brl: 100, balance_brl: 75, status: 'open' },
        },
        {
          invoice_id: 2,
          receivable_id: 99,
          status: 'active',
          receivable: { id: 99, original_amount_brl: 100, balance_brl: 75, status: 'open' },
        },
      ],
    })

    const result = await fetchFinancialReport({ dateFrom: '', dateTo: '', status: '' })

    expect(result.rows.find((row) => row.id === 1)?.balance_brl).toBe(75)
    expect(result.rows.find((row) => row.id === 2)?.balance_brl).toBe(75)
    expect(result.rows.find((row) => row.id === 3)?.balance_brl).toBe(40)
    expect(result.kpis.totalOpen).toBe(115)
    expect(result.accessDenied).toBe(false)
  })

  it('zera saldo exibido de invoice local coberta quando seus links ledger nao estao ativos', async () => {
    installReportMocks({
      invoices: [
        {
          id: 1,
          invoice_number: 'INV-1',
          invoice_type: 'individual',
          status: 'covered',
          total_brl: 100,
          balance_brl: 100,
          issued_at: '2026-05-20',
          due_date: '2026-05-30',
          created_at: '2026-05-20',
          customer: { id: 10, name: 'Cliente Alfa', cnpj_cpf: '12345678000195' },
        },
      ],
      links: [
        {
          invoice_id: 1,
          receivable_id: 99,
          status: 'settled_elsewhere',
          receivable: { id: 99, original_amount_brl: 100, balance_brl: 0, status: 'settled' },
        },
      ],
    })

    const result = await fetchFinancialReport({ dateFrom: '', dateTo: '', status: '' })

    expect(result.rows.find((row) => row.id === 1)?.balance_brl).toBe(0)
    expect(result.kpis.totalOpen).toBe(0)
  })

  it('calcula saldo por cliente a partir de receivables unicos e preserva granite como legado', async () => {
    installReportMocks({
      bls: [
        {
          customer_id: 10,
          total_weight_kg: 1000,
          total_cbm: 20,
          customer: { id: 10, name: 'Cliente Alfa', cnpj_cpf: '12345678000195' },
        },
      ],
      invoices: [
        { id: 1, customer_id: 10, invoice_type: 'individual', total_brl: 100, balance_brl: 100, status: 'issued' },
        { id: 2, customer_id: 10, invoice_type: 'consolidated', total_brl: 100, balance_brl: 100, status: 'issued' },
        { id: 3, customer_id: 10, invoice_type: 'granite', total_brl: 40, balance_brl: 40, status: 'issued' },
      ],
      links: [
        {
          invoice_id: 1,
          receivable_id: 99,
          status: 'active',
          receivable: { id: 99, original_amount_brl: 100, balance_brl: 75, status: 'open' },
        },
        {
          invoice_id: 2,
          receivable_id: 99,
          status: 'active',
          receivable: { id: 99, original_amount_brl: 100, balance_brl: 75, status: 'open' },
        },
      ],
    })

    const result = await fetchCustomerReport({ dateFrom: '', dateTo: '' })
    const row = result.rows[0]

    expect(row?.invoiceCount).toBe(3)
    expect(row?.totalIssued).toBe(140)
    expect(row?.totalBalance).toBe(115)
  })
})
