// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
      podRows={[{ pod: 'BRSSZ', eta: '2026-07-20', etb: null, ata: null, atd: null, rtw: null, linked: true } as never]}
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
