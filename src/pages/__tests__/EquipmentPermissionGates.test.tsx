// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  can: vi.fn<(permission: string) => boolean>(),
  effectiveRole: vi.fn(() => 'documentacao'),
  isAdmin: vi.fn(() => false),
  invalidateQueries: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === 'vazios-importacao-manifests' ? [] : { rows: [], count: 0 },
    isLoading: false,
    error: null,
  }),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    isAdmin: mocks.isAdmin(),
    effectiveRole: mocks.effectiveRole(),
    user: { id: 'user-1' },
    can: mocks.can,
  }),
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
import { Granite } from '../Granite'
import { Veiculos } from '../Veiculos'
import { VaziosImportacao } from '../VaziosImportacao'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.effectiveRole.mockReturnValue('documentacao')
  mocks.isAdmin.mockReturnValue(false)
})

afterEach(cleanup)

function renderPage(page: React.ReactNode, initialEntry = '/') {
  render(<MemoryRouter initialEntries={[initialEntry]}>{page}</MemoryRouter>)
}

describe('controles de Veiculos', () => {
  it('Equipamentos importa, mas nao recebe exclusao reservada ao admin', () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')
    mocks.can.mockImplementation((permission) => permission === 'veiculos_edit')

    renderPage(<Veiculos />, '/?voyage=7')

    expect(screen.getByRole('button', { name: 'Importar Veículos' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Excluir veiculo CHASSI-1' })).toBeNull()
  })

  it('Documentacao importa, mas nao recebe exclusao reservada ao admin', () => {
    mocks.effectiveRole.mockReturnValue('documentacao')
    mocks.can.mockImplementation((permission) => permission === 'veiculos_edit')

    renderPage(<Veiculos />, '/?voyage=7')

    expect(screen.getByRole('button', { name: 'Importar Veículos' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Excluir veiculo CHASSI-1' })).toBeNull()
  })

  it('admin recebe importacao e exclusao', () => {
    mocks.isAdmin.mockReturnValue(true)
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

describe('imports fora do escopo de Equipamentos', () => {
  it('oculta importacao de Granito', () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')

    renderPage(<Granite />)

    expect(screen.queryByRole('button', { name: 'Importar Planilha COSCO' })).toBeNull()
  })

  it('oculta importacao de Vazios IMP e preserva exportacao', () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')

    renderPage(<VaziosImportacao />)

    expect(screen.getByRole('button', { name: 'Exportar' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Importar Planilha' })).toBeNull()
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
