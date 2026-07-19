// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  can: vi.fn<(permission: string) => boolean>(),
  invalidateQueries: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: () => ({ data: { rows: [], count: 0 }, isLoading: false, error: null }),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: false, user: { id: 'user-1' }, can: mocks.can }),
}))
vi.mock('../../hooks/useVehicles', () => ({
  useVehicleOptions: () => ({ data: { voyages: [{ id: 7, voyage_number: '14N', vessel: { name: 'GREEN SANTOS' } }] } }),
  useVehicles: () => ({
    data: {
      rows: [{
        id: 11,
        chassis: 'CHASSI-1',
        brand: 'Marca',
        model: 'Modelo',
        weight_kg: 1200,
        cbm: 10,
        container: { container_number: 'CXRU1234567', type: '40HC', seal_number: 'L1' },
        bl: { id: 'BL-1' },
      }],
      count: 1,
      distinctContainerCount: 1,
      distinctBlCount: 1,
      totalWeightKg: 1200,
      vehiclesByBrand: [],
      vehiclesByContainerType: [],
      containersByContainerType: [],
    },
    isLoading: false,
    error: null,
  }),
}))
vi.mock('../../components/shared/VoyageCombobox', () => ({ VoyageCombobox: () => <div /> }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../services/vehicles', () => ({ deleteVehicles: vi.fn() }))
vi.mock('../../services/vehicleImport', () => ({
  importVehicleRows: vi.fn(),
  parseVehicleImportFile: vi.fn(),
}))
vi.mock('../../services/vaziosImport', () => ({
  importVaziosManifest: vi.fn(),
  listVaziosBookings: vi.fn(),
  parseVaziosManifestFile: vi.fn(),
}))

import { EmbarqueVazios } from '../EmbarqueVazios'
import { Veiculos } from '../Veiculos'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

function renderPage(page: React.ReactNode, initialEntry = '/') {
  render(<MemoryRouter initialEntries={[initialEntry]}>{page}</MemoryRouter>)
}

describe('controles de Veiculos', () => {
  it('exibe importacao e exclusao para quem possui veiculos_edit', () => {
    mocks.can.mockImplementation((permission) => permission === 'veiculos_edit')

    renderPage(<Veiculos />, '/?voyage=7')

    expect(screen.getByRole('button', { name: 'Importar Veículos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Excluir veiculo CHASSI-1' })).toBeTruthy()
  })

  it('oculta importacao e exclusao sem veiculos_edit', () => {
    mocks.can.mockReturnValue(false)

    renderPage(<Veiculos />, '/?voyage=7')

    expect(screen.queryByRole('button', { name: 'Importar Veículos' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Excluir veiculo CHASSI-1' })).toBeNull()
  })
})

describe('controles de Vazios EXP', () => {
  it('exibe importacao para quem possui vazios_edit', () => {
    mocks.can.mockImplementation((permission) => permission === 'vazios_edit')

    renderPage(<EmbarqueVazios />)

    expect(screen.getByRole('button', { name: 'Importar Planilha' })).toBeTruthy()
  })

  it('oculta importacao sem vazios_edit', () => {
    mocks.can.mockReturnValue(false)

    renderPage(<EmbarqueVazios />)

    expect(screen.queryByRole('button', { name: 'Importar Planilha' })).toBeNull()
  })
})
