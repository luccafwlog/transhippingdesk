// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Painel } from '../Painel'

const { showToast, writeFileMock, jsonToSheetMock } = vi.hoisted(() => ({
  showToast: vi.fn(),
  writeFileMock: vi.fn(),
  jsonToSheetMock: vi.fn(() => ({})),
}))

vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@e965/xlsx', () => ({
  utils: {
    json_to_sheet: jsonToSheetMock,
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: writeFileMock,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'dashboard') {
      return {
        data: {
          totalBls: 42,
          totalContainers: 7,
          pendingReview: 3,
          chargeReviewRequired: 2,
          readyForBilling: 9,
          pendingFinancial: 1,
          openInvoices: 5,
          openInvoicesAmount: 1000,
          invoicesAccessDenied: false,
          openAlerts: 0,
          blsWithoutCustomer: 0,
          podsWithoutChargeTable: 0,
        },
        isLoading: false,
        error: null,
      }
    }
    return {
      data: {
        rows: [{
          id: '1::SSZ',
          voyageId: 1,
          voyageNumber: 'V1',
          voyageStatus: 'active',
          vesselName: 'Navio ativo',
          pod: 'SSZ',
          eta: '2026-07-09',
          etb: null,
          ata: '2026-07-10',
          atb: '2026-07-10',
          rowType: 'import',
          vin: 1,
          car: 0,
          cg: 1,
          total: 1,
          mty: 0,
          rtw: null,
          bbMachines: 0,
          bbPackages: 0,
          bbTotal: 0,
          atd: null,
          ceStatus: 'waiting',
          linked: false,
          exportHasGranite: null,
          exportContainersQty: null,
          exportMovementsQty: null,
          exportCeStatus: null,
          exportLinked: null,
        }, {
          id: '2::RIO',
          voyageId: 2,
          voyageNumber: 'V2',
          voyageStatus: 'cancelled',
          vesselName: 'Navio cancelado',
          pod: 'RIO',
          eta: null,
          etb: null,
          ata: null,
          atb: '2026-07-10',
          rowType: 'import',
          vin: 0,
          car: 0,
          cg: 1,
          total: 1,
          mty: 0,
          rtw: null,
          bbMachines: 0,
          bbPackages: 0,
          bbTotal: 0,
          atd: '2026-07-11',
          ceStatus: 'waiting',
          linked: false,
          exportHasGranite: null,
          exportContainersQty: null,
          exportMovementsQty: null,
          exportCeStatus: null,
          exportLinked: null,
        }, {
          id: 'exp::3',
          voyageId: 3,
          voyageNumber: 'V3',
          voyageStatus: 'active',
          vesselName: 'Navio exportação',
          pod: 'SSZ',
          eta: null,
          etb: null,
          ata: null,
          atb: null,
          rowType: 'export',
          vin: 0,
          car: 0,
          cg: 0,
          total: 0,
          mty: 0,
          rtw: null,
          bbMachines: 0,
          bbPackages: 0,
          bbTotal: 0,
          atd: null,
          ceStatus: 'missing',
          linked: false,
          exportHasGranite: null,
          exportContainersQty: null,
          exportMovementsQty: null,
          exportCeStatus: 'approved',
          exportLinked: true,
        }],
        lastChangedAt: '2026-06-23T00:00:00Z',
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    }
  },
}))

beforeEach(() => {
  showToast.mockReset()
  writeFileMock.mockReset()
  jsonToSheetMock.mockClear()
})

afterEach(cleanup)

it('informa falha e encerra loading quando a exportacao do Line-Up falha', async () => {
  writeFileMock.mockImplementation(() => {
    throw new Error('disk full')
  })

  render(
    <MemoryRouter>
      <Painel />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }))

  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Falha ao exportar o Line Up.', 'error'))
  expect(screen.getByRole('button', { name: 'Exportar Excel' }).hasAttribute('disabled')).toBe(false)
})

it('exporta CEs e Linked da programação de exportação', async () => {
  render(
    <MemoryRouter>
      <Painel />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }))

  await waitFor(() => expect(writeFileMock).toHaveBeenCalled())
  expect(jsonToSheetMock).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ Navio: 'Navio exportação', CEs: 'approved', Linked: 'Sim' }),
  ]))
})

function renderPainel() {
  render(
    <MemoryRouter>
      <Painel />
    </MemoryRouter>,
  )
}

it('US-120: as celulas do Line-Up navegam para os destinos corretos', () => {
  renderPainel()

  // Os KPI cards do dashboard foram removidos; a navegacao migrou para as celulas
  // do Line-Up (commit "transform Painel table cells into navigation links").
  expect(screen.getByRole('link', { name: 'Navio ativo' }).getAttribute('href')).toBe('/viagens/1')
})

it('US-121: carrega o snapshot do Line-Up com a escala', () => {
  renderPainel()

  expect(screen.getAllByText('Navio ativo').length).toBeGreaterThan(0)
})

it('US-121: exibe escala aguardando com status vermelho', () => {
  renderPainel()

  expect(screen.getAllByText('Aguardando').some((element) => element.classList.contains('app-badge--red'))).toBe(true)
})

it('usa ATA na coluna ETA e destaca somente a escala atracada', () => {
  renderPainel()
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } })

  const actualArrival = screen.getByText('10/07')
  expect(actualArrival.classList.contains('text-green-600')).toBe(true)

  const berthedRow = screen.getByRole('link', { name: 'Navio ativo' }).closest('tr')
  const completedRow = screen.getByRole('link', { name: 'Navio cancelado' }).closest('tr')
  expect(berthedRow?.classList.contains('app-lineup-row--berthed')).toBe(true)
  expect(completedRow?.classList.contains('app-lineup-row--berthed')).toBe(false)
})

it('US-122: filtra o Line-Up por status de escala', () => {
  renderPainel()

  expect(screen.getByRole('link', { name: 'Navio ativo' })).toBeTruthy()

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'completed' } })
  expect(screen.queryByRole('link', { name: 'Navio ativo' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Navio exportação' })).toBeTruthy()

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } })
  expect(screen.getByRole('link', { name: 'Navio ativo' })).toBeTruthy()
})

it('filtra o Line-Up por escalas canceladas', () => {
  renderPainel()

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'cancelled' } })

  expect(screen.getByRole('link', { name: 'Navio cancelado' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Navio ativo' })).toBeNull()
})

it('combina busca por navio e filtro de veículos no Line-Up', () => {
  renderPainel()

  fireEvent.change(screen.getByLabelText('Busca'), { target: { value: 'navio' } })
  fireEvent.change(screen.getByLabelText('Veículos'), { target: { value: 'with' } })

  expect(screen.getByRole('link', { name: 'Navio ativo' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Navio cancelado' })).toBeNull()
})

it('US-123: oferece os atalhos para Chegadas/Saidas e para a tela TV', () => {
  renderPainel()

  expect(screen.getByRole('link', { name: /Chegadas e Sa/ }).getAttribute('href')).toBe('/chegadas-saidas')
  expect(screen.getByRole('link', { name: /Abrir tela TV/ }).getAttribute('href')).toBe('/line-up-tv/display')
})
