// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Painel } from '../Painel'

const { showToast, writeFileMock } = vi.hoisted(() => ({
  showToast: vi.fn(),
  writeFileMock: vi.fn(),
}))

vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@e965/xlsx', () => ({
  utils: {
    json_to_sheet: vi.fn(() => ({})),
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
          eta: null,
          etb: null,
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
          atd: null,
          ceStatus: 'waiting',
          linked: false,
          exportHasGranite: null,
          exportContainersQty: null,
          exportMovementsQty: null,
          exportCeStatus: null,
          exportLinked: null,
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
  const vesselLink = screen.getAllByText('Navio ativo')[0].closest('a')
  expect(vesselLink?.getAttribute('href')).toBe('/viagens/1')
})

it('US-121: carrega o snapshot do Line-Up com a escala e o horario de atualizacao', () => {
  renderPainel()

  expect(screen.getAllByText('Navio ativo').length).toBeGreaterThan(0)
  expect(screen.getByText(/Atualizado:/)).toBeTruthy()
})

it('US-121: exibe escala aguardando com status vermelho', () => {
  renderPainel()

  expect(screen.getByText('Aguardando').classList.contains('app-badge--red')).toBe(true)
})

it('US-122: filtra o Line-Up por status de escala', () => {
  renderPainel()

  expect(screen.getAllByText('Navio ativo').length).toBeGreaterThan(0)

  fireEvent.click(screen.getByRole('button', { name: 'Escalas concluidas' }))
  expect(screen.queryAllByText('Navio ativo').length).toBe(0)
  expect(screen.getAllByText('Nenhuma escala encontrada.').length).toBeGreaterThan(0)

  fireEvent.click(screen.getByRole('button', { name: 'Escalas ativas' }))
  expect(screen.getAllByText('Navio ativo').length).toBeGreaterThan(0)
})

it('filtra o Line-Up por escalas canceladas', () => {
  renderPainel()

  fireEvent.click(screen.getByRole('button', { name: 'Escalas canceladas' }))

  expect(screen.getAllByText('Navio cancelado')).toHaveLength(1)
  expect(screen.queryAllByText('Navio ativo')).toHaveLength(0)
})

it('US-123: oferece os atalhos para Chegadas/Saidas e para a tela TV', () => {
  renderPainel()

  expect(screen.getByRole('link', { name: /Chegadas e Sa/ }).getAttribute('href')).toBe('/chegadas-saidas')
  expect(screen.getByRole('link', { name: /Abrir tela TV/ }).getAttribute('href')).toBe('/line-up-tv/display')
})
