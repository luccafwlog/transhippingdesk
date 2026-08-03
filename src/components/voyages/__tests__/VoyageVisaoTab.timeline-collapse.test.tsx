// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-1' } }) }))
vi.mock('../../../hooks/useVoyageTimeline', () => ({ useVoyageTimeline: () => ({ data: undefined }) }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: undefined }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

import { VoyageVisaoTab } from '../VoyageVisaoTab'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('mostra apenas os 3 eventos mais recentes da linha do tempo, com opção de expandir', async () => {
  const user = userEvent.setup()
  const importBatches = [1, 2, 3, 4, 5].map((n) => ({
    id: n,
    uploaded_at: `2026-07-0${n}T10:00:00Z`,
    cargo_mode: 'container',
    filename: `manifesto-${n}.txt`,
    route: null,
  }))

  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[]}
      importBatches={importBatches as never}
      exportSchedules={[]}
      isAdmin={false}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={vi.fn()}
      onOmitPod={vi.fn()}
    />,
  )

  expect(screen.getAllByText('Manifesto importado')).toHaveLength(3)

  await user.click(screen.getByRole('button', { name: 'Mostrar todos os 5 eventos' }))

  expect(screen.getAllByText('Manifesto importado')).toHaveLength(5)
  expect(screen.getByRole('button', { name: 'Mostrar menos' })).toBeTruthy()
})
