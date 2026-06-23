// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  loadMaps: vi.fn(() => Promise.resolve({})),
  findMatch: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[0] === 'granite-bls'
      ? { data: { rows: [], count: 0 }, isLoading: false, error: null }
      : { data: undefined },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useBls', () => ({
  useVoyageOptions: () => ({ data: [{ id: 7, voyage_number: '14N', vessel: { name: 'GREEN' } }] }),
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../services/graniteImport', () => ({ parseGraniteManifestFile: mocks.parse, importGraniteManifest: vi.fn() }))
vi.mock('../../services/graniteCharges', () => ({ listGraniteBls: vi.fn(), calculateGraniteBlCharges: vi.fn() }))
vi.mock('../../services/billing', () => ({ createInvoiceFromGraniteBls: vi.fn() }))
vi.mock('../../services/customerReconciliation', () => ({ loadCustomerMaps: mocks.loadMaps, findMatchedCustomer: mocks.findMatch }))

import { Granite } from '../Granite'

function bl(overrides: Record<string, unknown> = {}) {
  return {
    rowNumber: 2,
    bl_number: 'BL-G1',
    shipper_name: 'Granito SA',
    shipper_cnpj: null,
    real_weight_kg: 5000,
    final_m3: null,
    phase: null,
    clientId: null,
    reconciliationStatus: 'missing_cnpj',
    ...overrides,
  }
}

function renderGranite() {
  render(
    <MemoryRouter>
      <Granite />
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('US-075: abre o modal de importacao e oferece a selecao de viagem', async () => {
  const user = userEvent.setup()
  renderGranite()

  await user.click(screen.getByRole('button', { name: /Importar Planilha COSCO/ }))

  expect(screen.getByText('Viagem de destino')).toBeTruthy()
  expect(screen.getByRole('option', { name: 'Selecione uma viagem' })).toBeTruthy()
  expect(screen.getAllByRole('option', { name: 'GREEN / 14N' }).length).toBeGreaterThan(0)
})

it('US-079: o preview alerta sobre B/Ls pendentes sem cliente resolvido', async () => {
  const user = userEvent.setup()
  mocks.parse.mockResolvedValue({ vesselVoyage: 'NAVIO/14', bls: [bl()], rowErrors: [] })
  renderGranite()

  await user.click(screen.getByRole('button', { name: /Importar Planilha COSCO/ }))
  await user.upload(screen.getByLabelText(/Arquivo/), new File(['x'], 'cosco.xlsx'))

  await waitFor(() => expect(screen.getByText(/sem cliente resolvido/)).toBeTruthy())
})

it('US-078: resolver o CNPJ no preview reconcilia o B/L pendente', async () => {
  const user = userEvent.setup()
  mocks.parse.mockResolvedValue({ vesselVoyage: 'NAVIO/14', bls: [bl()], rowErrors: [] })
  mocks.findMatch.mockReturnValue({ customer: { id: 99, name: 'Granito SA' } })
  renderGranite()

  await user.click(screen.getByRole('button', { name: /Importar Planilha COSCO/ }))
  await user.upload(screen.getByLabelText(/Arquivo/), new File(['x'], 'cosco.xlsx'))
  await waitFor(() => expect(screen.getByText(/sem cliente resolvido/)).toBeTruthy())

  await user.type(screen.getByPlaceholderText('Digite o CNPJ'), '11222333000181')

  // ao reconciliar, o alerta de pendencia desaparece
  await waitFor(() => expect(screen.queryByText(/sem cliente resolvido/)).toBeNull())
  expect(mocks.findMatch).toHaveBeenCalled()
})
