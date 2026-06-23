// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
  archive: vi.fn(),
  reorder: vi.fn(),
  from: vi.fn(),
}))

const vessels = [
  {
    id: 'vessel-1',
    vessel_name: 'ALPHA',
    voyage: '001',
    imo_number: '9876543',
    qingdao_etd: 'X',
    shanghai_etd: 'X',
    taicang_etd: 'X',
    ningbo_etd: 'X',
    nansha_etd: 'X',
    salvador_eta: 'X',
    vitoria_eta: 'X',
    pecem_eta: 'X',
    display_order: 0,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'vessel-2',
    vessel_name: 'BETA',
    voyage: '002',
    imo_number: null,
    qingdao_etd: 'X',
    shanghai_etd: 'X',
    taicang_etd: 'X',
    ningbo_etd: 'X',
    nansha_etd: 'X',
    salvador_eta: 'X',
    vitoria_eta: 'X',
    pecem_eta: 'X',
    display_order: 1,
    created_at: '',
    updated_at: '',
  },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: vessels, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../services/vesselScheduleAdmin', () => ({
  archiveVesselSchedule: mocks.archive,
  reorderVesselSchedules: mocks.reorder,
}))
vi.mock('../../services/supabase', () => ({
  supabase: { from: mocks.from },
}))

import { ChegadasSaidas } from '../ChegadasSaidas'

function mutationBuilder() {
  return {
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  }
}

describe('ChegadasSaidas user behaviours', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockImplementation(() => mutationBuilder())
    mocks.archive.mockResolvedValue(undefined)
    mocks.reorder.mockResolvedValue(undefined)
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('adds a vessel after the current last display order', async () => {
    const builder = mutationBuilder()
    mocks.from.mockReturnValue(builder)
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getByRole('button', { name: /Adicionar Navio/ }))
    await user.type(screen.getByLabelText('Nome do Navio'), 'GAMMA')
    await user.type(screen.getByLabelText('Viagem (VOY)'), '003')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(builder.insert).toHaveBeenCalledWith([
      expect.objectContaining({ vessel_name: 'GAMMA', voyage: '003', display_order: 2 }),
    ])
  })

  it('edits an existing vessel', async () => {
    const builder = mutationBuilder()
    mocks.from.mockReturnValue(builder)
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Editar')[0])
    const voyage = screen.getByLabelText('Viagem (VOY)')
    await user.clear(voyage)
    await user.type(voyage, '009')
    await user.click(screen.getByRole('button', { name: /Salvar/ }))

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ voyage: '009' }))
  })

  it('deletes a vessel only after confirmation', async () => {
    const builder = mutationBuilder()
    mocks.from.mockReturnValue(builder)
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Excluir')[0])

    expect(confirm).toHaveBeenCalled()
    expect(builder.delete).toHaveBeenCalled()
  })

  it('opens MarineTraffic with the vessel IMO', () => {
    render(<ChegadasSaidas />)

    expect(screen.getAllByRole('link', { name: 'ALPHA' })[0].getAttribute('href')).toBe(
      'https://www.marinetraffic.com/en/ais/details/ships/imo:9876543',
    )
  })

  it('reorders the complete list through the atomic service', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Descer')[0])

    expect(mocks.reorder).toHaveBeenCalledWith([
      { id: 'vessel-2', displayOrder: 0 },
      { id: 'vessel-1', displayOrder: 1 },
    ])
  })

  it('archives through the atomic service', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Encerrar')[0])

    expect(mocks.archive).toHaveBeenCalledWith('vessel-1')
  })
})
