// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  upsert: vi.fn(() => Promise.resolve({ error: null })),
  del: vi.fn(() => ({ eq: h.delEq })),
  delEq: vi.fn(() => Promise.resolve({ error: null })),
  upd: vi.fn(() => ({ eq: h.updEq })),
  updEq: vi.fn(() => Promise.resolve({ error: null })),
}))

const rates = [
  { id: 1, container_type: '20GP', free_days: 21, p1_day_from: 22, p1_day_to: 30, p1_usd: 100, p2_day_from: 31, p2_usd: 150, valid_from: null, valid_to: null, active: true, notes: null },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: rates, isLoading: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../services/demurrage/demurrageRates', () => ({ invalidateDemurrageRatesCache: vi.fn() }))
vi.mock('../../services/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: rates, error: null }) }),
      upsert: h.upsert,
      delete: h.del,
      update: h.upd,
    }),
  },
}))

import { DemurrageRates } from '../DemurrageRates'

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('US-051: lista as tarifas de demurrage', () => {
  render(<DemurrageRates />)
  expect(screen.getByText('20GP')).toBeTruthy()
  expect(screen.getByText('Ativo')).toBeTruthy()
})

it('US-052: cria uma nova tarifa pelo modal', async () => {
  const user = userEvent.setup()
  render(<DemurrageRates />)

  await user.click(screen.getByRole('button', { name: /Nova Tarifa/ }))
  await user.type(screen.getByPlaceholderText('20GP'), '40HC')
  await user.click(screen.getByRole('button', { name: 'Salvar' }))

  await waitFor(() => expect(h.upsert).toHaveBeenCalled())
  expect((h.upsert.mock.calls[0] as unknown[])[0]).toMatchObject({ container_type: '40HC' })
})

it('US-053: ativa/desativa a tarifa pelo badge de status', async () => {
  const user = userEvent.setup()
  render(<DemurrageRates />)

  await user.click(screen.getByText('Ativo').closest('button') as HTMLButtonElement)

  await waitFor(() => expect(h.upd).toHaveBeenCalledWith({ active: false }))
  expect(h.updEq).toHaveBeenCalledWith('id', 1)
})

it('US-054: exclui a tarifa', async () => {
  const user = userEvent.setup()
  render(<DemurrageRates />)

  await user.click(screen.getByRole('button', { name: 'Excluir tarifa' }))

  await waitFor(() => expect(h.del).toHaveBeenCalled())
  expect(h.delEq).toHaveBeenCalledWith('id', 1)
})
