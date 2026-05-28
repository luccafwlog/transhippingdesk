import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Faturamento } from '../Faturamento'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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

vi.mock('../../hooks/useBls', () => ({
  useVoyageOptions: () => ({ data: [] }),
}))

vi.mock('../../hooks/useBilling', () => ({
  useBillingCustomers: () => ({ data: [] }),
  useBillingReadyBls: () => ({ data: [], isLoading: false }),
  useBillingReadyGraniteBls: () => ({ data: [], isLoading: false }),
  useCancelInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateGraniteInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInvoiceDetail: () => ({ data: null, isLoading: false, error: null }),
  useInvoices: () => ({ data: { rows: [], count: 0 }, isLoading: false, error: null }),
  useRegisterInvoicePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

describe('Faturamento', () => {
  it('usa abas destacadas e inclui Pendencias', () => {
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Faturamento)))

    expect(html).toContain('class="app-tab app-tab--active"')
    expect(html).toContain('Pendências')
    expect(html).toContain('Valida')
    expect(html).toContain('Invoices (Taxas Locais + Granito)')
    expect(html).toContain('Demurrage')
  })
})
