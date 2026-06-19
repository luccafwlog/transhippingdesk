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
  const resolvedResult = { resolved: true, pendencias: [], reviewStatus: 'reviewed', updatedAt: null }
  return {
    ...actual,
    applyInlineBlReviewFix: vi.fn().mockResolvedValue(resolvedResult),
    saveBlReview: vi.fn().mockResolvedValue(resolvedResult),
    saveGraniteBlReview: vi.fn(),
  }
})
vi.mock('../../services/reviewBillingAutomation', () => ({
  tryAutoIssueInvoice: vi.fn().mockResolvedValue({ status: 'invoiced', invoiceResult: { invoice_id: 55 } }),
}))

import { useCustomerLookup } from '../../hooks/useCustomers'
import { useReviewQueue } from '../../hooks/useReview'
import { applyInlineBlReviewFix, saveBlReview } from '../../services/review'
import { tryAutoIssueInvoice } from '../../services/reviewBillingAutomation'
import { Revisao } from '../Revisao'

const mockedUseReviewQueue = vi.mocked(useReviewQueue)
const mockedUseCustomerLookup = vi.mocked(useCustomerLookup)
const mockedApplyInlineBlReviewFix = vi.mocked(applyInlineBlReviewFix)
const mockedSaveBlReview = vi.mocked(saveBlReview)
const mockedTryIssueInvoice = vi.mocked(tryAutoIssueInvoice)

function makeBl(id: string, consignee: string): ReviewQueueItem {
  return {
    id,
    source: 'bl',
    consignee,
    shipper: 'Shipper',
    customer_id: null,
    customer: null,
    charge_status: 'review_required',
    review_reasons: ['Cliente nao vinculado'],
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
  it('agrupa os B/Ls por cliente/consignatario', () => {
    renderPage()
    // grupos sao nomeados pelo consignatario quando nao ha cliente cadastrado
    expect(screen.getByText('AC Comercial')).toBeTruthy()
    expect(screen.getByText('Alma Trading')).toBeTruthy()
    // os tres B/Ls aparecem nas linhas
    expect(screen.getByText('BL1')).toBeTruthy()
    expect(screen.getByText('BL2')).toBeTruthy()
    expect(screen.getByText('BL3')).toBeTruthy()
  })

  it('vincula em lote todos os B/Ls de um cliente pelo cabecalho do grupo', async () => {
    const user = userEvent.setup()
    renderPage()

    // o grupo "AC Comercial" (2 B/Ls) e o primeiro na ordem alfabetica
    const pickers = screen.getAllByPlaceholderText('Vincular cliente...')
    await user.type(pickers[0], 'Cliente')
    await user.click(screen.getByText('Cliente Modelo'))

    await waitFor(() => expect(mockedApplyInlineBlReviewFix).toHaveBeenCalledTimes(2))
    expect(mockedApplyInlineBlReviewFix).toHaveBeenCalledWith(
      expect.objectContaining({ blId: 'BL1', field: 'customer_id', value: 99, changedBy: 'user-1' }),
    )
    expect(mockedApplyInlineBlReviewFix).toHaveBeenCalledWith(
      expect.objectContaining({ blId: 'BL2', field: 'customer_id', value: 99, changedBy: 'user-1' }),
    )
    // gate resolvido -> tenta faturar cada B/L
    expect(mockedTryIssueInvoice).toHaveBeenCalledTimes(2)
    expect(mockedTryIssueInvoice).toHaveBeenCalledWith({ blId: 'BL1', customerId: 99, actorId: 'user-1' })
    expect(mockedTryIssueInvoice).toHaveBeenCalledWith({ blId: 'BL2', customerId: 99, actorId: 'user-1' })
  })

  it('recalcula e emite a fatura ao salvar cliente pelo drawer', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getAllByRole('button', { name: 'Corrigir' })[0])
    await user.type(screen.getByPlaceholderText('Digite ao menos 2 caracteres'), 'Cliente')
    await user.click(screen.getByRole('button', { name: /Cliente Modelo/ }))
    await user.type(screen.getByLabelText('Justificativa obrigatória'), 'Cliente cadastrado e vinculado.')
    await user.click(screen.getByRole('button', { name: 'Marcar como revisado' }))

    await waitFor(() => expect(mockedSaveBlReview).toHaveBeenCalledTimes(1))
    expect(mockedTryIssueInvoice).toHaveBeenCalledWith({
      blId: 'BL1',
      customerId: 99,
      actorId: 'user-1',
    })
  })
})
