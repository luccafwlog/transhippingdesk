// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Hooks tocam Supabase/React Query no topo do modulo — mockados para isolar a UI.
const customers = [
  { id: 1, name: 'AC COMERCIAL IMPORTADORA E EXPORTADORA LTDA', cnpj_cpf: '07415554000956' },
  { id: 2, name: 'GOLDEN LOGISTICA INTERNACIONAL LTDA', cnpj_cpf: '21239198000130' },
]

vi.mock('../../../hooks/useBilling', () => ({
  useBillingCustomers: () => ({ data: customers }),
}))

vi.mock('../../../hooks/useBillingLedger', () => ({
  useConsolidatableReceivables: () => ({ data: [], isLoading: false }),
  useCreateConsolidatedInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { ConsolidatedInvoiceModal } from '../ConsolidatedInvoiceModal'

afterEach(cleanup)

function openModal() {
  render(<ConsolidatedInvoiceModal open onClose={() => {}} />)
  return screen.getByPlaceholderText('Buscar cliente...')
}

describe('ConsolidatedInvoiceModal — seletor de cliente', () => {
  it('abre o dropdown ao clicar e lista os clientes', async () => {
    const user = userEvent.setup()
    const input = openModal()

    expect(screen.queryByRole('listbox')).toBeNull()
    await user.click(input)

    const menu = screen.getByRole('listbox')
    const options = within(menu).getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0].textContent).toContain('AC COMERCIAL')
  })

  it('preenche o campo e fecha o dropdown ao selecionar', async () => {
    const user = userEvent.setup()
    const input = openModal()

    await user.click(input)
    await user.click(screen.getByText('GOLDEN LOGISTICA INTERNACIONAL LTDA'))

    expect((input as HTMLInputElement).value).toBe('GOLDEN LOGISTICA INTERNACIONAL LTDA')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('permite trocar de cliente apos selecionado', async () => {
    const user = userEvent.setup()
    const input = openModal()

    await user.click(input)
    await user.click(screen.getByText('GOLDEN LOGISTICA INTERNACIONAL LTDA'))

    // Reabrir e escolher outro cliente — o dropdown deve voltar a aparecer.
    await user.click(input)
    const menu = screen.getByRole('listbox')
    await user.click(within(menu).getByText('AC COMERCIAL IMPORTADORA E EXPORTADORA LTDA'))

    expect((input as HTMLInputElement).value).toBe('AC COMERCIAL IMPORTADORA E EXPORTADORA LTDA')
  })

  it('limpa o cliente pelo botao x', async () => {
    const user = userEvent.setup()
    const input = openModal()

    await user.click(input)
    await user.click(screen.getByText('GOLDEN LOGISTICA INTERNACIONAL LTDA'))
    expect((input as HTMLInputElement).value).toBe('GOLDEN LOGISTICA INTERNACIONAL LTDA')

    await user.click(screen.getByLabelText('Limpar cliente'))
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('Limpar cliente')).toBeNull()
  })

  it('fecha o dropdown ao clicar fora', async () => {
    const user = userEvent.setup()
    const input = openModal()

    await user.click(input)
    expect(screen.getByRole('listbox')).toBeTruthy()

    // Clicar num campo fora do picker (label "Buscar B/L") fecha o dropdown.
    await user.click(screen.getByText('Buscar B/L'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
