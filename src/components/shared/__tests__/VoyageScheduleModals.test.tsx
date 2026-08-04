// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// voyageRouteSchedules importa o cliente Supabase no topo do modulo; os modais
// so usam helpers puros dele (POD_CE_STATUS_OPTIONS, getEditableVoyagePodCeStatus).
vi.mock('../../../services/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))

import { EscalaModal, PolScheduleModal, type EscalaModalData } from '../VoyageScheduleModals'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

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

const escalaBase: EscalaModalData = {
  voyageId: 9,
  voyageLabel: 'NAVIO 456S',
  port: 'BRSSZ',
  temImportacao: true,
  eta: '2026-03-01',
  etb: null,
  ata: null,
  atb: '2026-03-02',
  etd: '2026-03-03',
  atd: null,
  rtw: 3,
  ceStatus: 'waiting',
  linked: true,
  escalaNumber: null,
  exportExistingId: null,
  temExportacao: false,
  hasGranite: false,
  containersQty: null,
  movementsQty: null,
  dischargePorts: [],
  exportLocked: false,
}

function renderEscala(escala: EscalaModalData, onSaved = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ConfirmDialogProvider>
      <EscalaModal open escala={escala} onClose={() => {}} onSaved={onSaved} />
    </ConfirmDialogProvider>,
  )
  return onSaved
}

describe('EscalaModal', () => {
  it('edita a escala existente sem oferecer troca de porto', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala(escalaBase)

    expect(screen.getByText('Escala: BRSSZ')).toBeTruthy()
    expect(screen.queryByLabelText('Porto da escala')).toBeNull()
    expect((screen.getByLabelText('ETA') as HTMLInputElement).value).toBe('2026-03-01')
    expect((screen.getByLabelText('RESTOW') as HTMLInputElement).value).toBe('3')

    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        voyageId: 9,
        port: 'BRSSZ',
        eta: '2026-03-01',
        etb: null,
        atb: '2026-03-02',
        rtw: 3,
        linked: true,
        exportacao: { temExportacao: false, hasGranite: false, containersQty: null, movementsQty: null, dischargePorts: [] },
      }),
    )
  })

  it('normaliza o porto por extenso antes de enviar', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({ ...escalaBase, port: 'Vitoria', temImportacao: false })

    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ port: 'BRVIX', temImportacao: false }))
  })

  it('recusa porto estrangeiro ao criar a escala', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({ ...escalaBase, port: null })

    await user.type(screen.getByLabelText('Porto da escala'), 'CNSHA')
    await user.click(screen.getByRole('button', { name: 'Adicionar escala' }))

    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('porto brasileiro')
  })

  it('so revela os campos de exportacao depois do toggle e os envia juntos', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({ ...escalaBase, port: null })

    expect(screen.queryByLabelText('CNTR (Vazios Exp.)')).toBeNull()

    await user.type(screen.getByLabelText('Porto da escala'), 'brvix')
    await user.click(screen.getByLabelText('Esta escala terá exportação'))
    await user.type(screen.getByLabelText('CNTR (Vazios Exp.)'), '10')
    await user.type(screen.getByLabelText('Portos de descarga'), 'itgoa, nlrtm')
    await user.click(screen.getByRole('button', { name: 'Adicionar escala' }))

    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 'BRVIX',
        exportacao: {
          temExportacao: true,
          hasGranite: false,
          containersQty: 10,
          movementsQty: null,
          dischargePorts: ['ITGOA', 'NLRTM'],
        },
      }),
    )
  })

  it('trava a retirada da exportacao quando ha carga vinculada', () => {
    renderEscala({ ...escalaBase, temExportacao: true, exportLocked: true, containersQty: 4 })

    const toggle = screen.getByLabelText('Esta escala terá exportação') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(toggle.disabled).toBe(true)
    expect(screen.getByText(/carga de exportação vinculada/i)).toBeTruthy()
  })
})
