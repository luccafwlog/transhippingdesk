import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TaxasLocais } from '../TaxasLocais'
import { isLedgerInvoicePayable } from '../faturamentoLedgerPayment'
import { invoiceStatusLabel } from '../faturamentoInvoiceStatus'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

// billing/export inicializam o cliente Supabase ao importar; o mock mantém este
// teste de render isolado de credenciais.
vi.mock('../../services/supabase', () => ({
  supabase: {},
  isSupabaseConfigured: false,
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('../../components/ui/Toast', async () => {
  const actual = await vi.importActual<typeof import('../../components/ui/Toast')>('../../components/ui/Toast')
  return {
    ...actual,
    useToast: () => ({ showToast: vi.fn() }),
  }
})

vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(),
}))

vi.mock('../../hooks/useBls', () => ({
  useVoyageOptions: () => ({ data: [] }),
}))

vi.mock('../../hooks/useBilling', () => ({
  useBillingCustomers: () => ({ data: [] }),
  useCancelInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateInvoiceDueDate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInvoiceDetail: () => ({ data: null, isLoading: false, error: null }),
  useInvoices: () => ({ data: { rows: [], count: 0 }, isLoading: false, error: null }),
  useRegisterInvoicePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddManualInvoiceCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteManualInvoiceCharge: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
}))

vi.mock('../../hooks/useBillingLedger', () => ({
  useConsolidatableReceivables: () => ({ data: [], isLoading: false }),
  useCreateConsolidatedInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRegisterLedgerInvoicePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePendingCodAdjustments: () => ({ data: [], isLoading: false, error: null }),
  useSettleCodAdjustment: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
  useInvoiceRefunds: () => ({ data: [] }),
  useSettleInvoiceRefund: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../hooks/useLocalCharges', () => ({
  useBatchCalculateLocalCharges: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLocalChargeOperations: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../../services/alerts', () => ({
  acknowledgeAlert: vi.fn(),
  closeAlert: vi.fn(),
  createAlert: vi.fn(),
  detectOverdueInvoices: vi.fn(() => Promise.resolve()),
  listFinancialAlerts: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../../services/operationalEvents', () => ({
  logOperationalEvent: vi.fn(),
}))

vi.mock('../../services/demurrage/demurrageInvoices', () => ({
  listDemurrageInvoices: vi.fn(() => Promise.resolve([])),
  getInvoiceDetail: vi.fn(),
}))

vi.mock('../../components/billing/ValidacaoTab', () => ({
  ValidacaoTab: () => React.createElement('div', null, 'Validacao mock'),
}))

describe('TaxasLocais', () => {
  it('usa abas destacadas com Faturas e Validação e mantém o painel de ajustes COD', () => {
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(TaxasLocais)))

    expect(html).toContain('class="app-tab app-tab--active"')
    expect(html).toContain('Valida')
    expect(html).toContain('Faturas')
    expect(html).toContain('Ajustes de COD')
    expect(html).not.toContain('role="tab" aria-selected="false">Pendências')
    // Demurrage não é mais uma aba, lista, modal, faixa ou impressão duplicada
    // nesta superfície; sua operação própria continua em /demurrage.
    expect(html).not.toContain('role="tab" aria-selected="false">Demurrage')
    expect(html).toContain('Vencidas')
  })

  it('redireciona ?tab=demurrage para /demurrage', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/faturamento?tab=demurrage'] },
        React.createElement(TaxasLocais),
      ),
    )
    // Navigate não renderiza marcação própria em SSR estático; a ausência das
    // abas confirma que o componente não montou a página normal.
    expect(html).not.toContain('billing-page__tabs')
  })

  it('expoe somente a acao de consolidada no faturamento local', () => {
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(TaxasLocais)))

    expect(html).toContain('Gerar fatura consolidada')
    expect(html).not.toContain('Nova Invoice')
    expect(html).not.toContain('B/L único')
  })

  it('exibe o cliente informado pelo atalho de Clientes no filtro de faturas', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/taxas-locais?tab=invoices&customer=42&customerName=ACME%20EXPORTS'] },
        React.createElement(TaxasLocais),
      ),
    )

    expect(html).toContain('value="ACME EXPORTS"')
  })

  it('reduz os status documentais a 3 estados operacionais e oculta os estados internos', () => {
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ['/?tab=invoices'] }, React.createElement(TaxasLocais)),
    )

    // O filtro de status nao expoe mais os estados internos do ledger.
    expect(html).not.toContain('Coberta')
    expect(html).not.toContain('Obsoleta')
    // covered/obsolete sao absorvidos por Paga/Cancelada; issued vira Emitida.
    expect(invoiceStatusLabel('issued')).toBe('Emitida')
    expect(invoiceStatusLabel('partially_paid')).toBe('Emitida')
    expect(invoiceStatusLabel('overdue')).toBe('Emitida')
    expect(invoiceStatusLabel('covered')).toBe('Paga')
    expect(invoiceStatusLabel('paid')).toBe('Paga')
    expect(invoiceStatusLabel('obsolete')).toBe('Cancelada')
    expect(invoiceStatusLabel('cancelled')).toBe('Cancelada')
  })

  it('mantem invoices locais parcialmente pagas no fluxo de baixa por ledger', () => {
    expect(isLedgerInvoicePayable({
      invoice_type: 'individual',
      status: 'partially_paid',
      balance_brl: 25,
    })).toBe(true)
    expect(isLedgerInvoicePayable({
      invoice_type: 'consolidated',
      status: 'overdue',
      balance_brl: 100,
    })).toBe(true)
    expect(isLedgerInvoicePayable({
      invoice_type: 'individual',
      status: 'covered',
      balance_brl: 100,
    })).toBe(false)
    expect(isLedgerInvoicePayable({
      invoice_type: 'granite',
      status: 'issued',
      balance_brl: 100,
    })).toBe(false)
  })
})
