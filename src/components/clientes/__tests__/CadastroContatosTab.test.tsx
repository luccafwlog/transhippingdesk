// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
  upsertCustomerContact: vi.fn(() => Promise.resolve({})),
  deleteCustomerContact: vi.fn(() => Promise.resolve(undefined)),
  updatePreference: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, isAdmin: true, can: () => true }),
}))
vi.mock('../../../hooks/usePortalProvisioning', () => ({
  usePortalProvisioningForCustomer: () => ({ data: undefined }),
}))
vi.mock('../../../hooks/useCustomerContactPreferences', () => ({
  useUpdateCustomerContactPreference: () => ({ isPending: false, mutate: mocks.updatePreference }),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../../services/customers', () => ({
  updateCustomerWithAudit: vi.fn(),
  upsertCustomerContact: mocks.upsertCustomerContact,
  deleteCustomerContact: mocks.deleteCustomerContact,
}))

import { CadastroContatosTab } from '../CadastroContatosTab'

const baseData = {
  id: 101,
  name: 'ACME',
  trade_name: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  notes: null,
  customer_contacts: [{ id: 5, name: 'Contato X', email: 'x@acme.com', phone: null, purpose: 'geral', is_primary: true }],
} as never

afterEach(() => {
  cleanup()
  mocks.invalidateQueries.mockClear()
  mocks.updatePreference.mockClear()
})

describe('CadastroContatosTab — invalidacao da timeline em mutacoes de contato', () => {
  it('invalida customer-detail e a timeline ao salvar um contato', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><CadastroContatosTab data={baseData} cnpj="12345678000195" /></MemoryRouter>)

    await user.type(screen.getByLabelText('Nome do contato'), 'Novo Contato')
    await user.click(screen.getByRole('button', { name: 'Salvar contato' }))

    expect(mocks.upsertCustomerContact).toHaveBeenCalled()
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-detail', '12345678000195'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-ficha', 'timeline', 101] })
  })

  it('invalida customer-detail e a timeline ao remover um contato', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><CadastroContatosTab data={baseData} cnpj="12345678000195" /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Remover contato' }))

    expect(mocks.deleteCustomerContact).toHaveBeenCalledWith(5)
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-detail', '12345678000195'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-ficha', 'timeline', 101] })
  })

  it('altera somente a Natureza escolhida, sem reutilizar purpose', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><CadastroContatosTab data={baseData} cnpj="12345678000195" /></MemoryRouter>)

    await user.click(screen.getByRole('checkbox', { name: 'Demurrage' }))

    expect(mocks.updatePreference).toHaveBeenCalledWith({
      customerId: 101,
      contactId: 5,
      nature: 'demurrage',
      enabled: false,
    })
    expect(screen.getByRole('checkbox', { name: 'Documentação' })).toHaveProperty('checked', true)
    expect((baseData as unknown as { customer_contacts: Array<{ purpose: string }> }).customer_contacts[0].purpose).toBe('geral')
  })
})
