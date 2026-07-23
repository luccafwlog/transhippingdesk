// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

const { listDepotsMock, listTariffsMock, listServicesMock, useAuthMock } = vi.hoisted(() => ({
  listDepotsMock: vi.fn(),
  listTariffsMock: vi.fn(),
  listServicesMock: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../../services/depots', async (importOriginal) => ({ ...(await importOriginal<object>()), listDepots: listDepotsMock, listDepotTariffs: listTariffsMock, listDepotServices: listServicesMock, upsertDepot: vi.fn(), upsertDepotTariff: vi.fn(), upsertDepotService: vi.fn(), deleteDepot: vi.fn(), deleteDepotService: vi.fn() }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(() => Promise.resolve(true)) }))

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
