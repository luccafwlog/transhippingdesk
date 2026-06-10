// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewQueueItem } from '../../hooks/useReview'

vi.mock('../../hooks/useReview', () => ({ useReviewQueue: vi.fn() }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../hooks/useCustomers', () => ({ useCustomerLookup: vi.fn() }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../services/charges/chargeOperationsService', () => ({ calculateBlLocalCharges: vi.fn() }))
vi.mock('../../services/customers', () => ({ createCustomer: vi.fn() }))
vi.mock('../../services/operationalEvents', () => ({ logOperationalEvent: vi.fn() }))
vi.mock('../../services/review', async () => {
  const actual = await vi.importActual<typeof import('../../services/review')>('../../services/review')
  return {
    ...actual,
    applyInlineBlReviewFix: vi.fn().mockResolvedValue(null),
    saveBlReview: vi.fn(),
    saveGraniteBlReview: vi.fn(),
  }
})
vi.mock('../../services/reviewBillingAutomation', () => ({
  tryIssueInvoiceAfterCustomerLink: vi.fn().mockResolvedValue({ status: 'invoiced', invoiceResult: { invoice_id: 55 } }),
}))

import { useCustomerLookup } from '../../hooks/useCustomers'
import { useReviewQueue } from '../../hooks/useReview'
import { applyInlineBlReviewFix } from '../../services/review'
import { tryIssueInvoiceAfterCustomerLink } from '../../services/reviewBillingAutomation'
import { Revisao } from '../Revisao'

const mockedUseReviewQueue = vi.mocked(useReviewQueue)
const mockedUseCustomerLookup = vi.mocked(useCustomerLookup)
const mockedApplyInlineBlReviewFix = vi.mocked(applyInlineBlReviewFix)
const mockedTryIssueInvoice = vi.mocked(tryIssueInvoiceAfterCustomerLink)

function makeBl(id: string, consignee: string): ReviewQueueItem {
  return {
    id,
    source: 'bl',
    consignee,
    shipper: 'Shipper',
    customer_id: null,
    customer: null,
    charge_status: 'review_required',
    review_reasons: ['Cliente nao vinculado automaticamente'],
    voyage: { id: 1, voyage_number: '14', vessel: { id: 1, name: 'GREEN SANTOS', carrier: null } },
    updated_at: `2026-06-10T12:00:00.${id.slice(-1)}Z`,
  } as unknown as ReviewQueueItem
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Revisao />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedUseReviewQueue.mockReturnValue({
    data: [makeBl('BL1', 'AC Comercial'), makeBl('BL2', 'AC Comercial'), makeBl('BL3', 'Alma Trading')],
    isLoading: false,
    error: null,
  } as never)
  mockedUseCustomerLookup.mockImplementation((search: string) => ({
    data: search.trim().length >= 2 ? [{ id: 99, name: 'Cliente Modelo', cnpj_cpf: '11222333000181' }] : [],
  } as never))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Revisao', () => {
  it('filtra por consignatario e vincula varios BLs selecionados ao mesmo cliente', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.selectOptions(screen.getByLabelText('Filtrar por consignatario'), 'AC Comercial')
    expect(screen.getByText('BL1')).toBeTruthy()
    expect(screen.getByText('BL2')).toBeTruthy()
    expect(screen.queryByText('BL3')).toBeNull()

    await user.click(screen.getByLabelText('Selecionar B/L BL1'))
    await user.click(screen.getByLabelText('Selecionar B/L BL2'))

    await user.type(screen.getByPlaceholderText('Buscar cliente para vincular...'), 'Cliente')
    await user.click(screen.getByText('Cliente Modelo'))
    await user.click(screen.getByRole('button', { name: 'Vincular cliente (2)' }))

    await waitFor(() => expect(mockedApplyInlineBlReviewFix).toHaveBeenCalledTimes(2))
    expect(mockedApplyInlineBlReviewFix).toHaveBeenCalledWith(expect.objectContaining({
      blId: 'BL1',
      field: 'customer_id',
      value: 99,
      changedBy: 'user-1',
    }))
    expect(mockedApplyInlineBlReviewFix).toHaveBeenCalledWith(expect.objectContaining({
      blId: 'BL2',
      field: 'customer_id',
      value: 99,
      changedBy: 'user-1',
    }))
    expect(mockedTryIssueInvoice).toHaveBeenCalledTimes(2)
    expect(mockedTryIssueInvoice).toHaveBeenCalledWith({ blId: 'BL1', customerId: 99, actorId: 'user-1' })
    expect(mockedTryIssueInvoice).toHaveBeenCalledWith({ blId: 'BL2', customerId: 99, actorId: 'user-1' })
    expect(screen.queryByText(/taxas locais ainda pendentes/)).toBeNull()
  })

  it('seleciona todos os BLs visiveis pelo checkbox do cabecalho', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.selectOptions(screen.getByLabelText('Filtrar por consignatario'), 'AC Comercial')
    await user.click(screen.getByLabelText('Selecionar todos os B/Ls visiveis'))

    expect(screen.getByText('2 B/Ls selecionados')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Vincular cliente (2)' })).toBeTruthy()
  })
})
