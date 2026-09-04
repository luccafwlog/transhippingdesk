// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
  updateCustomerWithAudit: vi.fn(() => Promise.resolve(true)),
  lastOnSaved: null as (() => void) | null,
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
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../services/customers', () => ({
  updateCustomerWithAudit: mocks.updateCustomerWithAudit,
}))
vi.mock('../CustomerContactConfiguration', () => ({
  CustomerContactConfiguration: ({ customerId, onSaved }: { customerId: number; onSaved?: () => void }) => {
    mocks.lastOnSaved = onSaved ?? null
    return (
      <div data-testid="customer-contact-configuration">
        <span>Configuração de contatos do cliente {customerId}</span>
        <button type="button" onClick={onSaved}>
          Simular Salvo
        </button>
      </div>
    )
  },
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
  mocks.showToast.mockClear()
  mocks.lastOnSaved = null
})

describe('CadastroContatosTab', () => {
  it('renderiza CustomerContactConfiguration e invalida customer-detail e timeline ao salvar contatos', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <CadastroContatosTab data={baseData} cnpj="12345678000195" />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('customer-contact-configuration')).toBeTruthy()
    expect(screen.getByText('Configuração de contatos do cliente 101')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Simular Salvo' }))

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-detail', '12345678000195'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customers'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-ficha', 'timeline', 101] })
  })

  it('salva cadastro do cliente com justificativa e atualiza queries', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <CadastroContatosTab data={baseData} cnpj="12345678000195" />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/justificativa/i), 'Atualização de endereço')
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }))

    expect(mocks.updateCustomerWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 101,
        justification: 'Atualização de endereço',
      }),
    )
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-detail', '12345678000195'] })
    expect(mocks.showToast).toHaveBeenCalledWith('Cadastro do cliente atualizado.', 'success')
  })
})
