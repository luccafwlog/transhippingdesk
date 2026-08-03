// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

const { confirm, deletePod, deleteExport } = vi.hoisted(() => ({
  confirm: vi.fn(),
  deletePod: vi.fn(),
  deleteExport: vi.fn(),
}))

vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-1' } }) }))
vi.mock('../../../hooks/useVoyageTimeline', () => ({ useVoyageTimeline: () => ({ data: undefined }) }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: undefined }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../../services/voyageRouteSchedules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/voyageRouteSchedules')>()),
  deleteVoyagePodSchedule: deletePod,
}))
vi.mock('../../../services/voyageExportSchedules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/voyageExportSchedules')>()),
  deleteVoyageExportSchedule: deleteExport,
}))

import { VoyageVisaoTab } from '../VoyageVisaoTab'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('pede confirmação antes de excluir planejamentos de POD e POL', async () => {
  confirm.mockResolvedValue(false)
  const user = userEvent.setup()
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[
        { port: 'BRSSZ', eta: '2026-07-20', etb: null, ata: null, atb: null, etd: null, atd: null, rtw: null, linked: true, temImportacao: true, temExportacao: false, temGranito: false, containersQty: null, movementsQty: null, divergences: [], omitted: false, deleted: false } as never,
        { port: 'BRVIX', eta: null, etb: null, ata: null, atb: null, etd: null, atd: null, rtw: null, linked: false, temImportacao: false, temExportacao: true, temGranito: false, containersQty: null, movementsQty: null, divergences: [], omitted: false, deleted: false } as never,
      ]}
      importBatches={[]}
      exportSchedules={[{ id: 9, pol: 'BRVIX', eta: null, etb: null, linked: false } as never]}
      isAdmin
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onAddPod={vi.fn()}
      onEditPod={vi.fn()}
      onOmitPod={vi.fn()}
      onEditExport={vi.fn()}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Excluir planejamento do POD BRSSZ' }))
  await user.click(screen.getByRole('button', { name: 'Excluir planejamento de exportação do POL BRVIX' }))

  expect(confirm).toHaveBeenCalledTimes(2)
  expect(deletePod).not.toHaveBeenCalled()
  expect(deleteExport).not.toHaveBeenCalled()
})

it('renderiza uma escala mista em uma linha com marcadores de importação e exportação', () => {
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[
        {
          port: 'BRVIX',
          eta: '2026-07-20',
          etb: '2026-07-21',
          ata: null,
          atb: null,
          etd: '2026-07-22',
          atd: null,
          rtw: null,
          ceStatus: 'received',
          linked: true,
          escalaNumber: null,
          temImportacao: true,
          temExportacao: true,
          temGranito: false,
          containersQty: 12,
          movementsQty: 14,
          divergences: [],
          omitted: false,
          deleted: false,
        } as never,
      ]}
      importBatches={[]}
      exportSchedules={[{ id: 'exp-1', voyageId: 7, pol: 'BRVIX', eta: '2026-07-20', etb: '2026-07-21', linked: true } as never]}
      isAdmin
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onAddPod={vi.fn()}
      onEditPod={vi.fn()}
      onOmitPod={vi.fn()}
      onEditExport={vi.fn()}
    />,
  )

  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('row')).toHaveLength(2)
  expect(within(table).getByText('BRVIX')).toBeTruthy()
  expect(within(table).getByText('Importação')).toBeTruthy()
  expect(within(table).getByText('Exportação')).toBeTruthy()
  expect(within(table).getByText('12 CNTRS')).toBeTruthy()
  expect(within(table).getByText('14 MOVES')).toBeTruthy()
})

it('exibe divergencia com os valores POD e POL na linha da escala', () => {
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[{
        port: 'BRVIX',
        eta: null,
        etb: null,
        ata: null,
        atb: null,
        etd: '2026-08-02',
        atd: null,
        rtw: null,
        ceStatus: null,
        linked: null,
        escalaNumber: null,
        temImportacao: true,
        temExportacao: true,
        temGranito: false,
        containersQty: null,
        movementsQty: null,
        divergences: [{
          field: 'etd',
          podValue: '2026-08-02',
          source: 'pol',
          sourceValue: '2026-08-03',
        }],
        omitted: false,
        deleted: false,
      } as never]}
      importBatches={[]}
      exportSchedules={[]}
      isAdmin={false}
      divergenceCount={1}
      ceCoverage={{ filled: 0, total: 0 }}
      onAddPod={vi.fn()}
      onEditPod={vi.fn()}
      onOmitPod={vi.fn()}
      onEditExport={vi.fn()}
    />,
  )

  expect(screen.getByText(/Diverg\u00eancia ETD: POD 2026-08-02 \/ POL 2026-08-03/)).toBeTruthy()
})

it('renderiza viagem só de exportação em uma linha sem marcador de importação', () => {
  render(
    <VoyageVisaoTab
      voyage={{ id: 8, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 02N"
      escalaRows={[
        {
          port: 'BRSSZ',
          eta: '2026-08-01',
          etb: null,
          ata: null,
          atb: null,
          etd: null,
          atd: null,
          rtw: null,
          ceStatus: 'waiting',
          linked: false,
          escalaNumber: null,
          temImportacao: false,
          temExportacao: true,
          temGranito: false,
          containersQty: 4,
          movementsQty: null,
          divergences: [],
          omitted: false,
          deleted: false,
        } as never,
      ]}
      importBatches={[]}
      exportSchedules={[{ id: 'exp-2', voyageId: 8, pol: 'BRSSZ', eta: '2026-08-01', etb: null, linked: false } as never]}
      isAdmin
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onAddPod={vi.fn()}
      onEditPod={vi.fn()}
      onOmitPod={vi.fn()}
      onEditExport={vi.fn()}
    />,
  )

  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('row')).toHaveLength(2)
  expect(within(table).getByText('BRSSZ')).toBeTruthy()
  expect(within(table).getByText('Exportação')).toBeTruthy()
  expect(within(table).queryByText('Importação')).toBeNull()
})
