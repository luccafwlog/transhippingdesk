// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

const { listRatesMock, useAuthMock } = vi.hoisted(() => ({
  listRatesMock: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../../services/vaziosExportOperations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listVaziosReorgRates: listRatesMock,
  upsertVaziosReorgRate: vi.fn(),
  deleteVaziosReorgRate: vi.fn(),
}))
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
  useAuthMock.mockReturnValue({ isAdmin: true })
  listRatesMock.mockResolvedValue([
    { id: 'r1', service: 'bundle', rate_brl: 150, active: true, valid_from: '2026-07-01', valid_to: null, created_at: '2026-07-01T00:00:00Z' },
    { id: 'r2', service: 'visual_check', rate_brl: 80.5, active: false, valid_from: '2026-06-01', valid_to: '2026-06-30', created_at: '2026-06-01T00:00:00Z' },
  ])

  renderPage()

  expect(await screen.findByText('Bundle')).toBeTruthy()
  expect(screen.getByText('Visual check')).toBeTruthy()
  expect(screen.getByText('R$ 150,00')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Nova tarifa/ })).toBeTruthy()
})

it('sem admin, a página é somente leitura', async () => {
  useAuthMock.mockReturnValue({ isAdmin: false })
  listRatesMock.mockResolvedValue([])

  renderPage()

  expect(await screen.findByText(/Nenhuma tarifa cadastrada/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Nova tarifa/ })).toBeNull()
})
