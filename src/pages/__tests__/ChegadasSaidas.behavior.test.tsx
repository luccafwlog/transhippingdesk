// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
  createOrAttach: vi.fn(),
  setShow: vi.fn(),
  effectiveRole: vi.fn(() => 'documentacao'),
}))

const vessels = [
  {
    voyageId: 1,
    vesselName: 'ALPHA',
    voyage: '001',
    imoNumber: '9876543',
    datesByLabel: { SALVADOR: '2026-01-22' },
    earliestEta: '2026-01-22',
  },
  {
    voyageId: 2,
    vesselName: 'BETA',
    voyage: '002',
    imoNumber: null,
    datesByLabel: {},
    earliestEta: null,
  },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: vessels, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, effectiveRole: mocks.effectiveRole() }),
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../services/voyageFromSchedule', () => ({
  createOrAttachVoyageFromSchedule: mocks.createOrAttach,
}))
vi.mock('../../services/voyages', () => ({
  setVoyageShowOnPortal: mocks.setShow,
}))
vi.mock('../../services/portalScheduleVoyages', () => ({
  fetchPortalScheduleVoyages: vi.fn(),
}))

import { ChegadasSaidas } from '../ChegadasSaidas'

describe('ChegadasSaidas user behaviours', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createOrAttach.mockResolvedValue({ voyageId: 3, created: true })
    mocks.setShow.mockResolvedValue(undefined)
    mocks.effectiveRole.mockReturnValue('documentacao')
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('cadastra viagem publicada no Portal via createOrAttachVoyageFromSchedule', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getByRole('button', { name: /Adicionar Navio/ }))
    await user.type(screen.getByLabelText('Nome do Navio'), 'GAMMA')
    await user.type(screen.getByLabelText('Viagem (VOY)'), '003')
    await user.click(screen.getAllByLabelText('Não escala')[5])
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(mocks.createOrAttach).toHaveBeenCalledWith(expect.objectContaining({
      vesselName: 'GAMMA',
      voyageNumber: '003',
    }), 'user-1', expect.objectContaining({ mode: 'form', voyageId: undefined }))
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['voyage-escala-schedules'] }))
  })

  it('preenche edição a partir da viagem projetada', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Editar')[0])
    expect((screen.getByLabelText('Nome do Navio') as HTMLInputElement).value).toBe('ALPHA')
    expect((screen.getByLabelText('Viagem (VOY)') as HTMLInputElement).value).toBe('001')
  })

  it('edicao salva com mode form e o voyageId conhecido (sem re-dedup)', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Editar')[0])
    await user.click(screen.getByRole('button', { name: /Salvar/ }))

    expect(mocks.createOrAttach).toHaveBeenCalledWith(
      expect.objectContaining({ vesselName: 'ALPHA', voyageNumber: '001' }),
      'user-1',
      expect.objectContaining({ mode: 'form', voyageId: 1 }),
    )
  })

  it('campos de identidade ficam read-only na edicao', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Editar')[0])
    expect((screen.getByLabelText('Nome do Navio') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Viagem (VOY)') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Número IMO') as HTMLInputElement).disabled).toBe(true)
  })

  it('remove apenas a publicação do Portal', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Remover do Portal')[0])

    expect(confirm).toHaveBeenCalled()
    expect(mocks.setShow).toHaveBeenCalledWith(1, false)
  })

  it('abre MarineTraffic com IMO da viagem', () => {
    render(<ChegadasSaidas />)

    expect(screen.getByRole('link', { name: 'ALPHA' }).getAttribute('href')).toBe(
      'https://www.marinetraffic.com/en/ais/details/ships/imo:9876543',
    )
  })

  it('permite escrita a Equipamentos', () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')
    render(<ChegadasSaidas />)

    expect(screen.getByRole('button', { name: /Adicionar Navio/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Fazer Upload/ })).toBeTruthy()
    expect(screen.getAllByTitle('Editar').length).toBeGreaterThan(0)
    expect(screen.getAllByTitle('Remover do Portal').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Baixar Planilha Modelo/ })).toBeTruthy()
  })
})
