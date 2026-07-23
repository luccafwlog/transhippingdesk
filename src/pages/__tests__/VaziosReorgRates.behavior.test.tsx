// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

const { listDepotsMock, listTariffsMock, listServicesMock, upsertDepotMock, deleteDepotMock, useAuthMock, confirmMock } = vi.hoisted(() => ({
  listDepotsMock: vi.fn(),
  listTariffsMock: vi.fn(),
  listServicesMock: vi.fn(),
  upsertDepotMock: vi.fn(),
  deleteDepotMock: vi.fn(),
  useAuthMock: vi.fn(),
  confirmMock: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../services/depots', async (importOriginal) => ({ ...(await importOriginal<object>()), listDepots: listDepotsMock, listDepotTariffs: listTariffsMock, listDepotServices: listServicesMock, upsertDepot: upsertDepotMock, upsertDepotTariff: vi.fn(), upsertDepotService: vi.fn(), deleteDepot: deleteDepotMock, deleteDepotService: vi.fn() }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => confirmMock }))

const { VaziosReorgRates } = await import('../VaziosReorgRates')

afterEach(cleanup)

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VaziosReorgRates />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('lista as tarifas com labels pt-BR e valor em BRL', async () => {
  useAuthMock.mockReturnValue({ isAdmin: true, can: () => true })
  listDepotsMock.mockResolvedValue([{ id: 'd1', code: 'D01', name: 'Depot 1', pol_port: 'BRSSZ', active: true }])
  listTariffsMock.mockResolvedValue([{ id: 'r1', depot_id: 'd1', handling_in_brl: 20, handling_out_brl: 130, transporte_brl: 0, storage_day_brl: 0, free_time_days: 5, valid_from: '2026-07-01', valid_to: null, active: true }])
  listServicesMock.mockResolvedValue([{ id: 's1', depot_id: 'd1', name: 'bundle', charge_basis: 'per_operation_qty', rate_brl: 150, valid_from: '2026-07-01', valid_to: null, active: true }])

  renderPage()

  expect(await screen.findByText('D01')).toBeTruthy()
  expect((await screen.findAllByText(/150,00/)).length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: /Novo depot/ })).toBeTruthy()
})

it('sem admin, a página é somente leitura', async () => {
  useAuthMock.mockReturnValue({ isAdmin: false, can: () => false })
  listDepotsMock.mockResolvedValue([])

  renderPage()

  expect(await screen.findByText(/Nenhum depot cadastrado/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Novo depot/ })).toBeNull()
})

it('"Novo depot" limpa a seleção e cria (não sobrescreve) o depot existente ao salvar', async () => {
  const user = userEvent.setup()
  useAuthMock.mockReturnValue({ isAdmin: true, can: () => true })
  listDepotsMock.mockResolvedValue([{ id: 'd1', code: 'D01', name: 'Depot 1', pol_port: 'BRSSZ', active: true }])
  listTariffsMock.mockResolvedValue([])
  listServicesMock.mockResolvedValue([])
  upsertDepotMock.mockResolvedValue(undefined)

  renderPage()
  await screen.findByText('D01')

  await user.click(screen.getByRole('button', { name: /Novo depot/ }))
  await user.type(screen.getByLabelText('Código'), 'D02')
  await user.click(screen.getByRole('button', { name: /Salvar depot/ }))

  expect(upsertDepotMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'D02', id: undefined }))
})

it('pede confirmação antes de excluir um depot', async () => {
  const user = userEvent.setup()
  useAuthMock.mockReturnValue({ isAdmin: true, can: () => true })
  listDepotsMock.mockResolvedValue([{ id: 'd1', code: 'D01', name: 'Depot 1', pol_port: 'BRSSZ', active: true }])
  listTariffsMock.mockResolvedValue([])
  listServicesMock.mockResolvedValue([])
  confirmMock.mockResolvedValueOnce(false)

  renderPage()
  await screen.findByText('D01')

  await user.click(screen.getByRole('button', { name: /Excluir/ }))

  expect(confirmMock).toHaveBeenCalled()
  expect(deleteDepotMock).not.toHaveBeenCalled()
})
