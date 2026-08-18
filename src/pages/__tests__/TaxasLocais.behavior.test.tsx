// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detailInvoiceId: vi.fn(),
  detectOverdue: vi.fn(),
  reportFailure: vi.fn(),
  invalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../hooks/useBilling', () => ({
  useInvoices: () => ({ data: { rows: [], count: 0 }, isLoading: false, error: null }),
}))
vi.mock('../../services/alerts', () => ({
  detectOverdueInvoices: mocks.detectOverdue,
  listFinancialAlerts: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../lib/telemetry', () => ({ reportBestEffortFailure: mocks.reportFailure }))
vi.mock('../../components/billing/InvoiceDetailModal', () => ({
  InvoiceDetailModal: ({ invoiceId }: { invoiceId: number | null }) => {
    mocks.detailInvoiceId(invoiceId)
    return <div data-testid="invoice-id">{String(invoiceId)}</div>
  },
}))
vi.mock('../../components/billing/ValidacaoTab', () => ({ ValidacaoTab: () => null }))
vi.mock('../../components/billing/FinancialAlertsPanel', () => ({ FinancialAlertsPanel: () => null }))
vi.mock('../../components/billing/InvoiceFiltersBar', () => ({ InvoiceFiltersBar: () => null }))
vi.mock('../../components/billing/InvoicesTable', () => ({ InvoicesTable: () => null }))
vi.mock('../../components/billing/ConsolidatedInvoiceModal', () => ({ ConsolidatedInvoiceModal: () => null }))

import { TaxasLocais } from '../TaxasLocais'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.detectOverdue.mockResolvedValue(undefined)
})
afterEach(cleanup)

it('opens the invoice supplied by the canonical URL query string', () => {
  render(<MemoryRouter initialEntries={['/taxas-locais?invoice=73']}><TaxasLocais /></MemoryRouter>)
  expect(screen.getByTestId('invoice-id').textContent).toBe('73')
})

it('records overdue detection failure without producing an unhandled rejection', async () => {
  const failure = new Error('overdue unavailable')
  mocks.detectOverdue.mockRejectedValue(failure)

  render(<MemoryRouter><TaxasLocais /></MemoryRouter>)

  await waitFor(() => expect(mocks.reportFailure).toHaveBeenCalledWith(
    'detectOverdueInvoices ao abrir Faturamento',
    failure,
  ))
})
