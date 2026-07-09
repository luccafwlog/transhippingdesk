import { beforeEach, describe, expect, it, vi } from 'vitest'

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('../supabase', () => ({ supabase: { from, rpc } }))

import { listBlTransshipments, listVoyageOmissions, omitVoyageEscala, setBlCod, setBlTransshipment } from '../transshipments'

describe('transshipments service', () => {
  beforeEach(() => {
    from.mockReset()
    rpc.mockReset()
  })

  it('chama a RPC omit_voyage_escala com os PODs normalizados', async () => {
    rpc.mockResolvedValue({ data: 7, error: null })

    const id = await omitVoyageEscala({
      voyageId: 1,
      omittedPod: ' salvador ',
      dischargePod: 'vitoria',
      reason: 'omissao',
      changedBy: 'user-1',
    })

    expect(id).toBe(7)
    expect(rpc).toHaveBeenCalledWith('omit_voyage_escala', {
      p_voyage_id: 1,
      p_omitted_pod: 'SALVADOR',
      p_discharge_pod: 'VITORIA',
      p_reason: 'omissao',
      p_changed_by: 'user-1',
    })
  })

  it('propaga erro da RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('x') })

    await expect(
      omitVoyageEscala({
        voyageId: 1,
        omittedPod: 'A',
        dischargePod: 'B',
        reason: null,
        changedBy: 'u',
      }),
    ).rejects.toThrow('x')
  })

  it('chama RPCs de transbordo e COD', async () => {
    rpc.mockResolvedValue({ error: null })

    await setBlTransshipment({
      blId: 'BL-1',
      omissionId: 9,
      onwardVesselName: 'THIRD VESSEL',
      onwardCarrier: 'THIRD',
      onwardVoyageNumber: 'T-1',
      onwardEtd: '2026-07-11',
      onwardEta: '2026-07-15',
      changedBy: 'user-1',
    })
    await setBlCod({ blId: 'BL-1', omissionId: 9, changedBy: 'user-1' })

    expect(rpc).toHaveBeenNthCalledWith(1, 'set_bl_transshipment', {
      p_bl_id: 'BL-1',
      p_omission_id: 9,
      p_onward_vessel_name: 'THIRD VESSEL',
      p_onward_carrier: 'THIRD',
      p_onward_voyage_number: 'T-1',
      p_onward_etd: '2026-07-11',
      p_onward_eta: '2026-07-15',
      p_changed_by: 'user-1',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'set_bl_cod', {
      p_bl_id: 'BL-1',
      p_omission_id: 9,
      p_changed_by: 'user-1',
    })
  })

  it('mapeia leituras das tabelas novas', async () => {
    const omissionsEq = vi.fn(() =>
      Promise.resolve({
        data: [{ id: 1, voyage_id: 2, omitted_pod: 'BRSSA', discharge_pod: 'BRVIT', reason: null }],
        error: null,
      }),
    )
    const transshipmentsEq = vi.fn(() =>
      Promise.resolve({
        data: [
          {
            id: 3,
            bl_id: 'BL-1',
            omission_id: 1,
            disposition: 'transshipment',
            onward_vessel_name: 'THIRD',
            onward_carrier: null,
            onward_voyage_number: null,
            onward_etd: null,
            onward_eta: '2026-07-15',
          },
        ],
        error: null,
      }),
    )

    from.mockImplementation((table: string) => {
      if (table === 'voyage_omissions') return { select: () => ({ eq: omissionsEq }) }
      if (table === 'bl_transshipments') return { select: () => ({ eq: transshipmentsEq }) }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    await expect(listVoyageOmissions(2)).resolves.toEqual([
      { id: 1, voyageId: 2, omittedPod: 'BRSSA', dischargePod: 'BRVIT', reason: null },
    ])
    await expect(listBlTransshipments(1)).resolves.toEqual([
      {
        id: 3,
        blId: 'BL-1',
        omissionId: 1,
        disposition: 'transshipment',
        onwardVesselName: 'THIRD',
        onwardCarrier: null,
        onwardVoyageNumber: null,
        onwardEtd: null,
        onwardEta: '2026-07-15',
      },
    ])
  })
})
