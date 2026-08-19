import { beforeEach, describe, expect, it, vi } from 'vitest'

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('../supabase', () => ({ supabase: { from, rpc } }))

import { listBlTransshipments, listBlTransshipmentByBlId, listVoyageOmissions, omitVoyageEscala, revertVoyageOmission, setBlCod, setBlTransshipment, updateVoyageOmission } from '../transshipments'

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
      onwardVesselName: ' COSCO STAR ',
      onwardCarrier: 'COSCO',
      onwardVoyageNumber: 'T-1',
      onwardEtd: '2026-07-20',
      onwardEta: '2026-07-25',
      changedBy: 'user-1',
    })

    expect(id).toBe(7)
    expect(rpc).toHaveBeenCalledWith('omit_voyage_escala', {
      p_voyage_id: 1,
      p_omitted_pod: 'SALVADOR',
      p_discharge_pod: 'VITORIA',
      p_reason: 'omissao',
      p_onward_vessel_name: ' COSCO STAR ',
      p_onward_carrier: 'COSCO',
      p_onward_voyage_number: 'T-1',
      p_onward_etd: '2026-07-20',
      p_onward_eta: '2026-07-25',
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
      changedBy: 'user-1',
    })
    await setBlCod({ blId: 'BL-1', omissionId: 9, changedBy: 'user-1' })

    expect(rpc).toHaveBeenNthCalledWith(1, 'set_bl_transshipment', {
      p_bl_id: 'BL-1',
      p_omission_id: 9,
      p_onward_vessel_name: null,
      p_onward_carrier: null,
      p_onward_voyage_number: null,
      p_onward_etd: null,
      p_onward_eta: null,
      p_changed_by: 'user-1',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'set_bl_cod', {
      p_bl_id: 'BL-1',
      p_omission_id: 9,
      p_changed_by: 'user-1',
    })
  })

  it('complementa o registro global com parametros nomeados', async () => {
    rpc.mockResolvedValue({ error: null })

    await updateVoyageOmission({
      omissionId: 9,
      onwardVesselName: 'COSCO STAR',
      onwardCarrier: 'COSCO',
      onwardVoyageNumber: 'T-1',
      onwardEtd: '2026-07-20',
      onwardEta: '2026-07-25',
      reason: 'congestionamento',
      changedBy: 'user-1',
    })

    expect(rpc).toHaveBeenCalledWith('update_voyage_omission', {
      p_omission_id: 9,
      p_onward_vessel_name: 'COSCO STAR',
      p_onward_carrier: 'COSCO',
      p_onward_voyage_number: 'T-1',
      p_onward_etd: '2026-07-20',
      p_onward_eta: '2026-07-25',
      p_reason: 'congestionamento',
      p_changed_by: 'user-1',
    })
  })

  it('chama a RPC de reversao com justificativa e autor', async () => {
    rpc.mockResolvedValue({ error: null })

    await revertVoyageOmission({ omissionId: 9, justification: 'POD informado incorretamente', changedBy: 'admin-1' })

    expect(rpc).toHaveBeenCalledWith('revert_voyage_omission', {
      p_omission_id: 9,
      p_justification: 'POD informado incorretamente',
      p_changed_by: 'admin-1',
    })
  })

  it('mapeia leituras das tabelas novas', async () => {
    const omissionsEq = vi.fn(() =>
      Promise.resolve({
        data: [{ id: 1, voyage_id: 2, omitted_pod: 'BRSSA', discharge_pod: 'BRVIT', reason: null, onward_vessel_name: 'THIRD', onward_carrier: null, onward_voyage_number: null, onward_etd: null, onward_eta: '2026-07-15' }],
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
      { id: 1, voyageId: 2, omittedPod: 'BRSSA', dischargePod: 'BRVIT', reason: null, onwardVesselName: 'THIRD', onwardCarrier: null, onwardVoyageNumber: null, onwardEtd: null, onwardEta: '2026-07-15' },
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

  it('localiza a disposição do B/L pelo bl_id, ordenando pela omissao mais recente', async () => {
    const limit = vi.fn(() => Promise.resolve({
      data: [{ id: 3, bl_id: 'BL-1', omission_id: 9, disposition: 'cod', onward_vessel_name: null, onward_carrier: null, onward_voyage_number: null, onward_etd: null, onward_eta: null }],
      error: null,
    }))
    const orderById = vi.fn(() => ({ limit }))
    const orderByOmittedAt = vi.fn(() => ({ order: orderById }))
    const eq = vi.fn(() => ({ order: orderByOmittedAt }))
    from.mockReturnValue({ select: () => ({ eq }) })

    await expect(listBlTransshipmentByBlId('BL-1')).resolves.toEqual({
      id: 3,
      blId: 'BL-1',
      omissionId: 9,
      disposition: 'cod',
      onwardVesselName: null,
      onwardCarrier: null,
      onwardVoyageNumber: null,
      onwardEtd: null,
      onwardEta: null,
    })
    expect(eq).toHaveBeenCalledWith('bl_id', 'BL-1')
    expect(orderByOmittedAt).toHaveBeenCalledWith('omitted_at', { foreignTable: 'voyage_omissions', ascending: false })
    expect(orderById).toHaveBeenCalledWith('id', { ascending: false })
    expect(limit).toHaveBeenCalledWith(1)
  })

  it('retorna null quando nao ha transbordo para o B/L', async () => {
    const limit = vi.fn(() => Promise.resolve({ data: [], error: null }))
    from.mockReturnValue({ select: () => ({ eq: () => ({ order: () => ({ order: () => ({ limit }) }) }) }) })

    await expect(listBlTransshipmentByBlId('BL-2')).resolves.toBeNull()
  })
})
