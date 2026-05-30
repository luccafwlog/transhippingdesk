// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// voyageRouteSchedules importa o cliente Supabase no topo do módulo; os modais
// só usam helpers puros dele (POD_CE_STATUS_OPTIONS, getEditableVoyagePodCeStatus).
vi.mock('../../../services/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))

import { PodScheduleModal, PolScheduleModal } from '../VoyageScheduleModals'

afterEach(cleanup)

describe('PolScheduleModal', () => {
  const base = {
    voyageId: 7,
    voyageLabel: 'NAVIO 123N',
    pol: 'CNNBO',
    etd: '2026-02-10',
  }

  it('não renderiza conteúdo quando fechado', () => {
    render(<PolScheduleModal open={false} polSchedule={base} onClose={() => {}} onSaved={async () => {}} />)
    expect(screen.queryByText('Editar ETD do POL')).toBeNull()
  })

  it('pré-preenche o ETD e envia o payload correto', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<PolScheduleModal open polSchedule={base} onClose={() => {}} onSaved={onSaved} />)

    // contexto exibido
    expect(screen.getByText('NAVIO 123N')).toBeTruthy()
    expect(screen.getByText('POL: CNNBO')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Salvar ETD' }))
    expect(onSaved).toHaveBeenCalledWith({ voyageId: 7, pol: 'CNNBO', etd: '2026-02-10' })
  })

  it('envia etd null quando o campo é limpo', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<PolScheduleModal open polSchedule={base} onClose={() => {}} onSaved={onSaved} />)

    await user.clear(screen.getByLabelText('ETD'))
    await user.click(screen.getByRole('button', { name: 'Salvar ETD' }))
    expect(onSaved).toHaveBeenCalledWith({ voyageId: 7, pol: 'CNNBO', etd: null })
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
    atd: null,
    rtw: 3,
    ceStatus: 'waiting' as const,
    linked: true,
  }

  it('pré-preenche datas/restow/escala e envia o payload tipado', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<PodScheduleModal open podSchedule={base} onClose={() => {}} onSaved={onSaved} />)

    expect(screen.getByText('POD: BRSSZ')).toBeTruthy()
    expect((screen.getByLabelText('ETA') as HTMLInputElement).value).toBe('2026-03-01')
    expect((screen.getByLabelText('RESTOW') as HTMLInputElement).value).toBe('3')

    await user.click(screen.getByRole('button', { name: 'Salvar datas' }))
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        voyageId: 9,
        pod: 'BRSSZ',
        eta: '2026-03-01',
        etb: null,
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
})
