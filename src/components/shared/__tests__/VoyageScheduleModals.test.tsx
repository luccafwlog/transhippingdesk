// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// voyageRouteSchedules importa o cliente Supabase no topo do modulo; os modais
// so usam helpers puros dele (POD_CE_STATUS_OPTIONS, getEditableVoyagePodCeStatus).
vi.mock('../../../services/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))

import {
  AddPodToVoyageModal,
  ExportScheduleModal,
  PodScheduleModal,
  PolScheduleModal,
} from '../VoyageScheduleModals'

afterEach(cleanup)

describe('PolScheduleModal', () => {
  const base = {
    voyageId: 7,
    voyageLabel: 'NAVIO 123N',
    pol: 'CNNBO',
    pod: 'BRSSZ',
    etd: '2026-02-10',
    atd: '2026-02-12',
    ceMaster: null,
    batchIds: [11, 12],
  }

  it('nao renderiza conteudo quando fechado', () => {
    render(<PolScheduleModal open={false} polSchedule={base} onClose={() => {}} onSaved={async () => {}} />)
    expect(screen.queryByText('Editar ETD + ATD e CE Master')).toBeNull()
  })

  it('pre-preenche ETD/ATD e envia o payload correto', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<PolScheduleModal open polSchedule={base} onClose={() => {}} onSaved={onSaved} />)

    expect(screen.getByText('NAVIO 123N')).toBeTruthy()
    expect(screen.getByText('Rota: CNNBO -> BRSSZ')).toBeTruthy()
    expect((screen.getByLabelText('ETD') as HTMLInputElement).value).toBe('2026-02-10')
    expect((screen.getByLabelText('ATD') as HTMLInputElement).value).toBe('2026-02-12')

    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSaved).toHaveBeenCalledWith({
      voyageId: 7,
      pol: 'CNNBO',
      pod: 'BRSSZ',
      etd: '2026-02-10',
      atd: '2026-02-12',
      ceMaster: null,
      batchIds: [11, 12],
    })
  })

  it('envia etd/atd null quando os campos sao limpos', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<PolScheduleModal open polSchedule={base} onClose={() => {}} onSaved={onSaved} />)

    await user.clear(screen.getByLabelText('ETD'))
    await user.clear(screen.getByLabelText('ATD'))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSaved).toHaveBeenCalledWith({
      voyageId: 7,
      pol: 'CNNBO',
      pod: 'BRSSZ',
      etd: null,
      atd: null,
      ceMaster: null,
      batchIds: [11, 12],
    })
  })

  it('pre-preenche e envia o CE Master para os batches do manifesto', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(
      <PolScheduleModal open polSchedule={{ ...base, ceMaster: '25BR00481' }} onClose={() => {}} onSaved={onSaved} />,
    )

    expect((screen.getByLabelText('CE Master') as HTMLInputElement).value).toBe('25BR00481')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ ceMaster: '25BR00481', batchIds: [11, 12] }))
  })

  it('edita CE Master por rota mesmo sem batch de manifesto (#322)', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(
      <PolScheduleModal
        open
        polSchedule={{ ...base, ceMaster: '25BR00481', batchIds: [] }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    )

    expect(screen.getByText('Editar ETD + ATD e CE Master')).toBeTruthy()
    expect((screen.getByLabelText('CE Master') as HTMLInputElement).value).toBe('25BR00481')

    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ pod: 'BRSSZ', ceMaster: '25BR00481', batchIds: [] }))
  })
})

describe('PodScheduleModal', () => {
  const base = {
    voyageId: 9,
    voyageLabel: 'NAVIO 456S',
    pod: 'BRSSZ',
    eta: '2026-03-01',
    etb: null,
    ata: null,
    atb: '2026-03-02',
    etd: '2026-03-03',
    atd: null,
    rtw: 3,
    ceStatus: 'waiting' as const,
    linked: true,
    escalaNumber: null,
  }

  it('pre-preenche datas/restow/escala e envia o payload tipado', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<PodScheduleModal open podSchedule={base} onClose={() => {}} onSaved={onSaved} />)

    expect(screen.getByText('POD: BRSSZ')).toBeTruthy()
    expect((screen.getByLabelText('ETA') as HTMLInputElement).value).toBe('2026-03-01')
    expect((screen.getByLabelText('ATB') as HTMLInputElement).value).toBe('2026-03-02')
    expect((screen.getByLabelText('ETD') as HTMLInputElement).value).toBe('2026-03-03')
    expect((screen.getByLabelText('RESTOW') as HTMLInputElement).value).toBe('3')

    await user.click(screen.getByRole('button', { name: 'Salvar datas' }))
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        voyageId: 9,
        pod: 'BRSSZ',
        eta: '2026-03-01',
        etb: null,
        atb: '2026-03-02',
        etd: '2026-03-03',
        rtw: 3,
        linked: true,
      }),
    )
  })

  it('converte restow vazio para null e escala para boolean', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(
      <PodScheduleModal
        open
        podSchedule={{ ...base, rtw: null, linked: false }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Salvar datas' }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ rtw: null, linked: false }))
  })

  it('converte ATB e ETD vazios para null', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<PodScheduleModal open podSchedule={base} onClose={() => {}} onSaved={onSaved} />)

    await user.clear(screen.getByLabelText('ATB'))
    await user.clear(screen.getByLabelText('ETD'))
    await user.click(screen.getByRole('button', { name: 'Salvar datas' }))

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ atb: null, etd: null }))
  })

  it('normaliza o porto da escala antes de enviar o payload', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(
      <PodScheduleModal
        open
        podSchedule={{ ...base, pod: 'Vitoria' }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Salvar datas' }))

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ pod: 'BRVIX' }))
  })
})

describe('AddPodToVoyageModal', () => {
  const voyage = { voyageId: 5, voyageLabel: 'NAVIO X 10N' }

  it('mantem o botao desabilitado enquanto o POD esta vazio', () => {
    render(<AddPodToVoyageModal open voyage={voyage} onClose={() => {}} onSaved={async () => {}} />)
    expect((screen.getByRole('button', { name: 'Adicionar POD' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('normaliza o POD para maiusculas e envia o payload de criacao', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<AddPodToVoyageModal open voyage={voyage} onClose={() => {}} onSaved={onSaved} />)

    await user.type(screen.getByLabelText('POD'), 'brssa')
    await user.click(screen.getByRole('button', { name: 'Adicionar POD' }))

    expect(onSaved).toHaveBeenCalledWith({
      voyageId: 5,
      pod: 'BRSSA',
      eta: null,
      etb: null,
      ata: null,
      atd: null,
      rtw: null,
      ceStatus: 'waiting',
      linked: false,
      escalaNumber: null,
    })
  })
})

describe('ExportScheduleModal', () => {
  const exportData = {
    voyageId: 8,
    voyageLabel: 'NAVIO Y 20S',
    existing: {
      pol: 'brvix',
      eta: '2026-04-01',
      etb: null,
      hasGranite: true,
      containersQty: 10,
      movementsQty: null,
      ceStatus: 'waiting' as const,
      linked: true,
    },
  }

  it('pre-preenche a partir do registro existente', () => {
    render(<ExportScheduleModal open exportData={exportData as never} onClose={() => {}} onSaved={async () => {}} />)
    expect((screen.getByLabelText('POL (Porto de Embarque)') as HTMLInputElement).value).toBe('brvix')
    expect((screen.getByLabelText('CNTR (Vazios Exp.)') as HTMLInputElement).value).toBe('10')
    expect((screen.getByLabelText('Movimentos') as HTMLInputElement).value).toBe('')
  })

  it('envia POL em maiusculas e converte quantidades vazias para null', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<ExportScheduleModal open exportData={exportData as never} onClose={() => {}} onSaved={onSaved} />)

    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        voyageId: 8,
        pol: 'BRVIX',
        hasGranite: true,
        containersQty: 10,
        movementsQty: null,
        eta: '2026-04-01',
        linked: true,
      }),
    )
  })
})
