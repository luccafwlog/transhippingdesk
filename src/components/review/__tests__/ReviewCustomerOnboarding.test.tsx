// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReviewCustomerOnboarding } from '../ReviewCustomerOnboarding'
import type { ReviewGroup } from '../../../pages/revisaoHelpers'

const reviewOnboardingMocks = vi.hoisted(() => ({
  lookupCustomer: { id: 7, name: 'Cliente Existente', cnpj_cpf: '11222333000181', customer_contacts: [{ email: 'financeiro@existente.com' }] },
}))
vi.mock('../../../hooks/useCustomers', () => ({ useCustomerLookup: () => ({ data: [reviewOnboardingMocks.lookupCustomer] }) }))

const group = { key: 'document:11222333000181', cnpj: '11222333000181', displayName: 'Alfa', identityKind: 'document', candidateCnpjs: ['11222333000181'], canBulkOnboard: true, items: [{ id: 'BL1', source: 'bl', customer_id: null }] } as never as ReviewGroup

function renderForm(onSubmit = vi.fn()) {
  return { onSubmit, ...render(<ReviewCustomerOnboarding group={group} existingCustomerId={null} existingCustomer={null} initialName="Alfa" initialCnpj="11222333000181" initialEmail="" saving={false} onSelectExistingCustomer={vi.fn()} onSubmit={onSubmit} />) }
}

describe('ReviewCustomerOnboarding', () => {
  it('exige e-mail e mantém o convite desmarcado por padrão', () => {
    renderForm()
    expect(screen.getByText('E-mail principal do cliente')).toBeTruthy()
    expect(screen.getByText(/Opcional — você poderá iniciar o convite depois/)).toBeTruthy()
    expect(screen.queryByText('Informe um CNPJ válido para liberar o vínculo.')).toBeNull()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: /criar cliente e vincular 1 b\/ls/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('envia o convite somente após a seleção explícita, para o mesmo e-mail', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    await user.type(screen.getByPlaceholderText('financeiro@cliente.com.br'), ' Financeiro@Example.com ')
    expect((screen.getByRole('button', { name: /criar cliente e vincular 1 b\/ls/i }) as HTMLButtonElement).disabled).toBe(false)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /criar cliente e vincular 1 b\/ls/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ email: 'financeiro@example.com', sendPortalInvite: true }))
  })

  it('preenche o e-mail conhecido ao selecionar um cliente existente', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: /Cliente Existente/ }))

    expect((screen.getByPlaceholderText('financeiro@cliente.com.br') as HTMLInputElement).value).toBe('financeiro@existente.com')
  })
})
