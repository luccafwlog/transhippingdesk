// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1' }, isAdmin: true }),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('../../../hooks/useBilling', () => ({
  useInvoiceDetail: () => ({
    data: {
      invoice: {
        id: 9,
        invoice_number: 'INV-9',
        status: 'issued',
        total_brl: 100,
        total_paid_brl: 0,
        balance_brl: 100,
        customer_name: 'Cliente',
        customer_cnpj_cpf: '123',
        issued_at: '2026-06-23',
      },
      bls: [],
      items: [],
      payments: [],
    },
    isLoading: false,
    error: null,
  }),
  useRegisterInvoicePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddManualInvoiceCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteManualInvoiceCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../hooks/useBillingLedger', () => ({
  useInvoiceRefunds: () => ({ data: [] }),
  useRegisterLedgerInvoicePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSettleInvoiceRefund: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../InvoiceDocumentLocal', () => ({
  InvoiceDocumentLocal: () => <div data-testid="print-document">printable invoice</div>,
}))
vi.mock('../../../services/alerts', () => ({ createAlert: vi.fn() }))
vi.mock('../../../services/operationalEvents', () => ({ logOperationalEvent: vi.fn() }))

import { InvoiceDetailModal } from '../InvoiceDetailModal'

afterEach(cleanup)

it('opens the printable invoice only after the user requests printing', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.queryByTestId('print-document')).toBeNull()
  await user.click(screen.getByRole('button', { name: /Imprimir PDF/ }))
  expect(screen.getByTestId('print-document')).toBeTruthy()
})
