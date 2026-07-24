// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  can: vi.fn<(permission: string) => boolean>(),
  effectiveRole: vi.fn(() => 'documentacao'),
  isAdmin: vi.fn(() => false),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  updateVaziosBooking: vi.fn(() => Promise.resolve()),
  upsertVaziosExportOperation: vi.fn(() => Promise.resolve({ id: 'operation-1' })),
  upsertOperationServiceQty: vi.fn(() => Promise.resolve()),
  vaziosRows: [] as Array<Record<string, unknown>>,
  vaziosOperation: null as Record<string, unknown> | null,
  vaziosOperationError: null as Error | null,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'vazios-importacao-manifests') {
      return { data: [], isLoading: false, error: null }
    }
    if (queryKey[0] === 'vazios-bookings') {
      return {
        data: { rows: mocks.vaziosRows, count: mocks.vaziosRows.length },
        isLoading: false,
        error: null,
      }
    }
    if (queryKey[0] === 'vazios-export-operation') {
      return { data: mocks.vaziosOperation, isLoading: false, error: mocks.vaziosOperationError }
    }
    if (queryKey[0] === 'vazios-bookings' && queryKey[1] === 'operation-options') {
      return { data: { rows: mocks.vaziosRows }, isLoading: false, error: null }
    }
    if (queryKey[0] === 'vazios-cost-catalog') {
      return { data: { depots: new Map([['d1', { id: 'd1', free_time_days: 2 }]]), services: [{ id: 's1', depot_id: 'd1', name: 'Bundle Composition', calc_type: 'quantidade', rate_brl: 30, subject_to_overtime: false, active: true, valid_from: '2026-01-01', valid_to: null }] }, isLoading: false, error: null }
    }
    return { data: { rows: [], count: 0 }, isLoading: false, error: null }
  },
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
vi.mock('../../services/vaziosExportOperations', () => ({
  getVaziosExportOperation: vi.fn(),
  listVaziosBookingsForOperation: vi.fn(),
  updateVaziosBooking: mocks.updateVaziosBooking,
  upsertOperationServiceQty: mocks.upsertOperationServiceQty,
  upsertVaziosExportOperation: mocks.upsertVaziosExportOperation,
}))

import { EmbarqueVazios } from '../EmbarqueVazios'
import { Granite } from '../Granite'
import { Veiculos } from '../Veiculos'
import { VaziosImportacao } from '../VaziosImportacao'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.effectiveRole.mockReturnValue('documentacao')
  mocks.isAdmin.mockReturnValue(false)
  mocks.vaziosRows = []
  mocks.vaziosOperation = null
  mocks.vaziosOperationError = null
})

afterEach(cleanup)

function renderPage(page: React.ReactNode, initialEntry = '/') {
  render(<MemoryRouter initialEntries={[initialEntry]}>{page}</MemoryRouter>)
}

function vaziosBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    manifest_id: 'manifest-1',
    booking_number: 'BK-001',
    container_number: 'ABCD1234567',
    container_type: '40HC',
    movement_date: '2026-07-01',
    origin_terminal: 'Terminal A',
    destination: 'Destino A',
    notes: null,
    embark_port: 'BRSSA',
    depot: 'VBR',
    material: true,
    bundle: false,
    transporte: true,
    hand_in_date: '2026-07-01',
    hand_out_date: '2026-07-05',
    overtime_handling: true,
    overtime_transport: false,
    created_at: '2026-07-01T10:00:00Z',
    manifest: {
      id: 'manifest-1',
      voyage_id: 7,
      voyage: { id: 7, voyage_number: '14N', vessel: { id: 1, name: 'GREEN SANTOS' } },
    },
    ...overrides,
  }
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

  it('mantem o accordion ADR em somente leitura sem vazios_edit', () => {
    mocks.can.mockReturnValue(false)
    mocks.vaziosRows = [vaziosBooking()]

    renderPage(<EmbarqueVazios />)
    fireEvent.click(screen.getByRole('button', { name: 'Expandir dados ADR do booking BK-001' }))

    expect(screen.getByText('Somente leitura')).toBeTruthy()
    expect((screen.getByLabelText('Porto de embarque do booking BK-001') as HTMLInputElement).readOnly).toBe(true)
    expect((screen.getByLabelText('Material do armador do booking BK-001') as HTMLInputElement).disabled).toBe(true)
  })

  it('salva a edicao inline e invalida os bookings com vazios_edit', async () => {
    mocks.can.mockImplementation((permission) => permission === 'vazios_edit')
    mocks.vaziosRows = [vaziosBooking()]

    renderPage(<EmbarqueVazios />)
    fireEvent.click(screen.getByRole('button', { name: 'Expandir dados ADR do booking BK-001' }))
    const depot = screen.getByLabelText('Depot do booking BK-001')
    fireEvent.change(depot, { target: { value: 'DEPOT NOVO' } })
    fireEvent.blur(depot)

    await waitFor(() => expect(mocks.updateVaziosBooking).toHaveBeenCalledWith(
      'booking-1',
      { depot: 'DEPOT NOVO' },
    ))
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['vazios-bookings'] })
  })

  it('exibe a operacao da escala e salva a OS por viagem e porto', async () => {
    mocks.can.mockImplementation((permission) => permission === 'vazios_edit')
    mocks.vaziosRows = [vaziosBooking()]

    renderPage(<EmbarqueVazios />, '/?voyage=7')

    expect(screen.getByText('Operação da escala')).toBeTruthy()
    const qty = screen.getByLabelText('Bundle Composition quantidade')
    fireEvent.change(qty, { target: { value: '3' } })
    fireEvent.blur(qty)
    await waitFor(() => expect(mocks.upsertOperationServiceQty).toHaveBeenCalled())
    expect((mocks.upsertOperationServiceQty.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]).toMatchObject({ depotServiceId: 's1', qty: 3 })
    expect(screen.getByText('R$ 30,00')).toBeTruthy()
    const os = screen.getByLabelText('OS da operação')
    fireEvent.change(os, { target: { value: 'OS-77' } })
    fireEvent.blur(os)

    await waitFor(() => expect(mocks.upsertVaziosExportOperation).toHaveBeenCalledWith({
      voyageId: 7,
      embarkPort: 'BRSSA',
      osNumber: 'OS-77',
    }))
  })

  it('bloqueia escritas quando a operacao existente nao pode ser carregada', () => {
    mocks.can.mockImplementation((permission) => permission === 'vazios_edit')
    mocks.vaziosRows = [vaziosBooking()]
    mocks.vaziosOperationError = new Error('indisponivel')

    renderPage(<EmbarqueVazios />, '/?voyage=7')

    expect((screen.getByLabelText('OS da operação') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Bundle Composition quantidade') as HTMLInputElement).disabled).toBe(true)
    expect(mocks.upsertVaziosExportOperation).not.toHaveBeenCalled()
  })
})
