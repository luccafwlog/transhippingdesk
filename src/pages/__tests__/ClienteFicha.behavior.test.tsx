// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detail: { data: null as Record<string, unknown> | null, isLoading: false, error: null as Error | null },
  showToast: vi.fn(),
  confirm: vi.fn(),
  invalidateQueries: vi.fn(),
  upsertContact: vi.fn(),
  deleteContact: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useParams: () => ({ cnpj: '12345678000195' }) }
})
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: () => ({ data: null, error: null, isPending: false }),
  useMutation: (options: Record<string, unknown>) => ({
    mutateAsync: options.mutationFn,
    isPending: false,
  }),
}))
vi.mock('../../hooks/useCustomers', () => ({
  useCustomerDetail: () => mocks.detail,
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1' }, isAdmin: true }),
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
}))
vi.mock('../../services/customers', () => ({
  upsertCustomerContact: mocks.upsertContact,
  deleteCustomerContact: mocks.deleteContact,
  getCustomerPortalAccount: vi.fn(),
  setCustomerPortalAccountActive: vi.fn(),
  updateCustomerWithAudit: vi.fn(),
  upsertCustomerPortalAccount: vi.fn(),
  provisionPortalAuthUser: vi.fn(),
}))

import { ClienteFicha } from '../ClienteFicha'

const customer = {
  id: 42,
  cnpj_cpf: '12345678000195',
  name: 'Cliente Teste',
  trade_name: null,
  address: null,
  city: 'Vitoria',
  state: 'ES',
  zip: null,
  notes: null,
  payment_terms_days: 10,
  discount_pct: 0,
  commercial_notes: null,
  customer_contacts: [{
    id: 7,
    customer_id: 42,
    name: 'Contato Atual',
    email: 'atual@example.com',
    phone: null,
    purpose: 'geral',
    is_primary: false,
    created_at: null,
  }],
  bls: [],
  invoices: [],
  pending_balance: 0,
  invoices_access_denied: false,
}

function renderPage() {
  return render(<MemoryRouter><ClienteFicha /></MemoryRouter>)
}

describe('ClienteFicha user behaviours', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detail = { data: customer, isLoading: false, error: null }
    mocks.confirm.mockResolvedValue(true)
    mocks.upsertContact.mockResolvedValue({ id: 7 })
    mocks.deleteContact.mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('creates or edits a contact and refreshes the customer detail', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Editar' }))
    const name = screen.getByLabelText('Nome do contato')
    await user.clear(name)
    await user.type(name, 'Financeiro')
    await user.click(screen.getByRole('button', { name: 'Salvar contato' }))

    expect(mocks.upsertContact).toHaveBeenCalledWith(42, expect.objectContaining({
      id: 7,
      name: 'Financeiro',
      email: 'atual@example.com',
    }))
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['customer-detail', '12345678000195'],
    })
  })

  it('removes a contact only after explicit confirmation', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Remover contato' }))

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Remover contato',
      tone: 'danger',
    }))
    expect(mocks.deleteContact).toHaveBeenCalledWith(7)
  })

  it('shows a not-found state for an unknown customer', () => {
    mocks.detail = {
      data: null,
      isLoading: false,
      error: Object.assign(new Error('JSON object requested, multiple (or no) rows returned'), { code: 'PGRST116' }),
    }

    renderPage()
    expect(screen.getByText('Cliente não encontrado.')).toBeTruthy()
  })

  it('shows an infrastructure error separately from not found', () => {
    mocks.detail = {
      data: null,
      isLoading: false,
      error: Object.assign(new Error('database unavailable'), { code: '08006' }),
    }

    renderPage()
    expect(screen.getByText('Falha ao consultar o cliente.')).toBeTruthy()
  })
})
