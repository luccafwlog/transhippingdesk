import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  createVoyage: vi.fn(),
  setShow: vi.fn(),
  findVoyage: vi.fn(),
  savePol: vi.fn(),
  savePod: vi.fn(),
  listPod: vi.fn(),
}))

vi.mock('../voyages', () => ({
  createVoyage: calls.createVoyage,
  setVoyageShowOnPortal: calls.setShow,
  findVoyageByNumberAndVessel: calls.findVoyage,
}))

vi.mock('../voyageRouteSchedules', () => ({
  saveVoyagePolSchedule: calls.savePol,
  saveVoyagePodSchedule: calls.savePod,
  listVoyagePodSchedules: calls.listPod,
  buildVoyagePodEntityId: (id: number, pod: string) => `${id}::${pod}`,
}))

import { createOrAttachVoyageFromSchedule } from '../voyageFromSchedule'

describe('createOrAttachVoyageFromSchedule', () => {
  beforeEach(() => {
    Object.values(calls).forEach((call) => call.mockReset())
    calls.listPod.mockResolvedValue(new Map())
  })

  it('anexa a viagem existente, publica no Portal e salva so ETD/ETA', async () => {
    calls.findVoyage.mockResolvedValue(42)

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [
        { code: 'CNTAO', kind: 'pol', date: '2026-01-04' },
        { code: 'CNSHA', kind: 'pol', date: null },
        { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
      ],
    }, 'user-1')

    expect(calls.createVoyage).not.toHaveBeenCalled()
    expect(calls.setShow).toHaveBeenCalledWith(42, true)
    expect(calls.savePol).toHaveBeenCalledWith({ voyageId: 42, pol: 'CNTAO', etd: '2026-01-04', changedBy: 'user-1' })
    expect(calls.savePod).toHaveBeenCalledWith(expect.objectContaining({
      voyageId: 42,
      pod: 'BRSSA',
      eta: '2026-01-22',
      ata: null,
      atd: null,
      rtw: null,
      linked: false,
    }))
  })

  it('cria viagem quando nao encontra dedup por VOY+navio', async () => {
    calls.findVoyage.mockResolvedValue(null)
    calls.createVoyage.mockResolvedValue({ id: 7 })

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [],
    }, null)

    expect(calls.createVoyage).toHaveBeenCalledWith(expect.objectContaining({
      carrierScac: 'CSSC',
      vesselName: 'GREEN PECEM',
      voyageNumber: '6',
      status: 'active',
    }), null)
    expect(calls.setShow).toHaveBeenCalledWith(7, true)
  })
})
