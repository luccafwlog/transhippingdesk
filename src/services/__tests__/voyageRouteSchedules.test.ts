import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, updateMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  updateMock: vi.fn(),
}))

vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

import {
  deriveAutomaticVoyagePodCeStatus,
  listVoyagePodSchedules,
  listVoyagePolSchedules,
  projectVoyageEscalaSchedules,
  saveVoyagePodSchedule,
  saveVoyagePolSchedule,
} from '../voyageRouteSchedules'

beforeEach(() => {
  fromMock.mockReset()
  updateMock.mockReset()
})

describe('deriveAutomaticVoyagePodCeStatus', () => {
  it('deriva o status automatico sem promover para aprovado', () => {
    expect(deriveAutomaticVoyagePodCeStatus(0, 3)).toBe('missing')
    expect(deriveAutomaticVoyagePodCeStatus(1, 3)).toBe('launching')
    expect(deriveAutomaticVoyagePodCeStatus(3, 3)).toBe('approving')
  })

  it('nao deriva status quando nao ha B/Ls na rota', () => {
    expect(deriveAutomaticVoyagePodCeStatus(0, 0)).toBeNull()
  })
})

describe('projectVoyageEscalaSchedules', () => {
  it('projeta escala brasileira com somente linha POD', () => {
    const escalas = projectVoyageEscalaSchedules({
      podSchedules: [{
        entityId: '12::BRSSZ',
        voyageId: 12,
        pod: 'BRSSZ',
        eta: '2026-08-01',
        etb: '2026-08-02',
        ata: '2026-08-03',
        atb: '2026-08-04',
        etd: '2026-08-05',
        atd: '2026-08-06',
        rtw: 7,
        ceStatus: 'received',
        linked: true,
        escalaNumber: '001',
        deleted: false,
        omitted: false,
      }],
    })

    expect(escalas).toEqual([expect.objectContaining({
      voyageId: 12,
      port: 'BRSSZ',
      eta: '2026-08-01',
      etb: '2026-08-02',
      ata: '2026-08-03',
      atb: '2026-08-04',
      etd: '2026-08-05',
      atd: '2026-08-06',
      rtw: 7,
      ceStatus: 'received',
      linked: true,
      escalaNumber: '001',
      omitted: false,
      deleted: false,
      temImportacao: true,
      temExportacao: false,
      temGranito: false,
      containersQty: null,
      movementsQty: null,
      divergences: [],
    })])
  })

  it('projeta escala brasileira com somente linha POL', () => {
    const escalas = projectVoyageEscalaSchedules({
      polSchedules: [{
        entityId: '12::BRVIX',
        voyageId: 12,
        pol: 'BRVIX',
        atd: '2026-08-06',
        etd: '2026-08-05',
        escalaNumber: '002',
      }],
    })

    expect(escalas).toEqual([expect.objectContaining({
      voyageId: 12,
      port: 'BRVIX',
      eta: null,
      etb: null,
      ata: null,
      atb: null,
      etd: '2026-08-05',
      atd: '2026-08-06',
      escalaNumber: '002',
      temImportacao: false,
      temExportacao: true,
      divergences: [],
    })])
  })

  it('mantem POD canonico e reporta divergencia quando POL colide em ETD', () => {
    const escalas = projectVoyageEscalaSchedules({
      podSchedules: [{
        entityId: '12::BRVIX',
        voyageId: 12,
        pod: 'BRVIX',
        eta: null,
        etb: null,
        ata: null,
        atb: null,
        etd: '2026-08-05',
        atd: null,
        rtw: null,
        ceStatus: null,
        linked: null,
        escalaNumber: null,
        deleted: false,
        omitted: false,
      }],
      polSchedules: [{
        entityId: '12::BRVIX',
        voyageId: 12,
        pol: 'BRVIX',
        atd: null,
        etd: '2026-08-07',
        escalaNumber: null,
      }],
    })

    expect(escalas).toEqual([expect.objectContaining({
      port: 'BRVIX',
      etd: '2026-08-05',
      temImportacao: true,
      temExportacao: true,
      divergences: [{
        field: 'etd',
        podValue: '2026-08-05',
        source: 'pol',
        sourceValue: '2026-08-07',
      }],
    })])
  })

  it('remove POL estrangeiro e normaliza porto brasileiro por extenso', () => {
    const escalas = projectVoyageEscalaSchedules({
      polSchedules: [
        {
          entityId: '12::CNSHA',
          voyageId: 12,
          pol: 'CNSHA',
          atd: '2026-08-01',
          etd: '2026-07-30',
          escalaNumber: '001',
        },
        {
          entityId: '12::Vitoria',
          voyageId: 12,
          pol: 'Vitoria',
          atd: '2026-08-06',
          etd: '2026-08-05',
          escalaNumber: '002',
        },
      ],
    })

    expect(escalas).toHaveLength(1)
    expect(escalas[0]).toEqual(expect.objectContaining({ port: 'BRVIX' }))
  })

  it('inclui somente EXP brasileira e preserva marcadores de exportacao', () => {
    const escalas = projectVoyageEscalaSchedules({
      exportSchedulesByPort: new Map([
        ['BRSSA', {
          id: 'exp-1',
          voyageId: 12,
          pol: 'SALVADOR',
          hasGranite: true,
          containersQty: 10,
          movementsQty: 14,
          eta: '2026-08-01',
          etb: '2026-08-02',
          ceStatus: 'waiting',
          linked: true,
        }],
        ['CNSHA', {
          id: 'exp-2',
          voyageId: 12,
          pol: 'CNSHA',
          hasGranite: false,
          containersQty: 99,
          movementsQty: 99,
          eta: '2026-07-01',
          etb: '2026-07-02',
          ceStatus: 'waiting',
          linked: false,
        }],
      ]),
    })

    expect(escalas).toEqual([expect.objectContaining({
      port: 'BRSSA',
      eta: '2026-08-01',
      etb: '2026-08-02',
      ceStatus: 'waiting',
      linked: true,
      temImportacao: false,
      temExportacao: true,
      temGranito: true,
      containersQty: 10,
      movementsQty: 14,
    })])
  })

  it('preserva datas do portador POD sem marcar importacao ao editar escala somente de exportacao', () => {
    const escalas = projectVoyageEscalaSchedules({
      podSchedules: [{
        entityId: '12::BRVIX',
        voyageId: 12,
        pod: 'BRVIX',
        eta: '2026-08-01',
        etb: '2026-08-02',
        ata: '2026-08-03',
        atb: '2026-08-04',
        etd: '2026-08-05',
        atd: null,
        rtw: null,
        ceStatus: 'waiting',
        linked: false,
        escalaNumber: null,
        temImportacao: false,
        deleted: false,
        omitted: false,
      }],
      exportSchedulesByPort: new Map([
        ['BRVIX', {
          id: 'exp-1',
          voyageId: 12,
          pol: 'BRVIX',
          hasGranite: false,
          containersQty: 4,
          movementsQty: 2,
          eta: '2026-08-01',
          etb: '2026-08-02',
          ceStatus: 'waiting',
          linked: false,
        }],
      ]),
    })

    expect(escalas).toEqual([expect.objectContaining({
      port: 'BRVIX',
      eta: '2026-08-01',
      etb: '2026-08-02',
      ata: '2026-08-03',
      atb: '2026-08-04',
      temImportacao: false,
      temExportacao: true,
      containersQty: 4,
      movementsQty: 2,
    })])
  })

  it('preserva a escala de exportacao quando o POD foi soft-deletado', () => {
    const escalas = projectVoyageEscalaSchedules({
      podSchedules: [{
        entityId: '12::BRSSZ',
        voyageId: 12,
        pod: 'BRSSZ',
        eta: '2026-08-01',
        etb: null,
        ata: null,
        atb: null,
        etd: null,
        atd: null,
        rtw: null,
        ceStatus: null,
        linked: null,
        escalaNumber: null,
        deleted: true,
        omitted: false,
      }],
      polSchedules: [{
        entityId: '12::BRSSZ',
        voyageId: 12,
        pol: 'BRSSZ',
        atd: null,
        etd: '2026-08-05',
        escalaNumber: '001',
      }],
    })

    expect(escalas).toMatchObject([{ port: 'BRSSZ', temImportacao: false, temExportacao: true }])
  })
})

it('nao reverte uma viagem cancelada quando o ATD muda', async () => {
  let auditSelects = 0
  const auditLogs = {
    select: vi.fn(() => {
      auditSelects += 1
      if (auditSelects === 1) {
        return {
          eq: vi.fn(() => ({
            in: vi.fn(() => ({ order: vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) })) })),
          })),
        }
      }
      return {
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn(async () => ({
              data: [{ entity_id: '12::BRSSZ', field_name: 'atd', new_value: null, changed_at: null }],
              error: null,
            })),
          })),
        })),
      }
    }),
    insert: vi.fn(async () => ({ error: null })),
  }
  const voyages = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: { status: 'cancelled' }, error: null })) })),
    })),
    update: updateMock.mockReturnValue({ eq: vi.fn(async () => ({ error: null })) }),
  }

  fromMock.mockImplementation((table: string) => (table === 'audit_logs' ? auditLogs : voyages))

  await saveVoyagePodSchedule({
    voyageId: 12,
    pod: 'BRSSZ',
    eta: null,
    etb: null,
    ata: null,
    atd: '2026-07-10',
    rtw: null,
    ceStatus: null,
    linked: null,
    changedBy: 'user-1',
  })

  expect(updateMock).not.toHaveBeenCalled()
})

it('hidrata o ATD mais recente ao listar schedules de POL', async () => {
  const auditLogs = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn(async () => ({
              data: [
                { entity_id: '12::CNSHA', field_name: 'atd', new_value: '2026-07-10', changed_at: '2026-07-10T12:00:00Z' },
                { entity_id: '12::CNSHA', field_name: 'atd', new_value: '2026-07-09', changed_at: '2026-07-09T12:00:00Z' },
                { entity_id: '12::CNSHA', field_name: 'etd', new_value: '2026-07-08', changed_at: '2026-07-08T12:00:00Z' },
                { entity_id: '12::CNSHA', field_name: 'escala_number', new_value: '001', changed_at: '2026-07-07T12:00:00Z' },
              ],
              error: null,
            })),
          })),
        })),
      })),
    })),
  }

  fromMock.mockImplementation((table: string) => {
    expect(table).toBe('audit_logs')
    return auditLogs
  })

  const schedules = await listVoyagePolSchedules(['12::CNSHA'])

  expect(schedules.get('12::CNSHA')).toEqual({
    entityId: '12::CNSHA',
    voyageId: 12,
    pol: 'CNSHA',
    atd: '2026-07-10',
    etd: '2026-07-08',
    escalaNumber: '001',
  })
})

it('grava audit row de ATD por POL sem quebrar callers antigos', async () => {
  const insertMock = vi.fn(async () => ({ error: null }))
  const auditLogs = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn(async () => ({
              data: [
                { entity_id: '12::CNSHA', field_name: 'etd', new_value: '2026-07-08', changed_at: '2026-07-08T12:00:00Z' },
              ],
              error: null,
            })),
          })),
        })),
      })),
    })),
    insert: insertMock,
  }

  fromMock.mockImplementation((table: string) => {
    expect(table).toBe('audit_logs')
    return auditLogs
  })

  await saveVoyagePolSchedule({
    voyageId: 12,
    pol: 'CNSHA',
    etd: '2026-07-08',
    atd: '2026-07-10',
    changedBy: 'user-1',
    justification: 'ATD documental',
  })

  expect(insertMock).toHaveBeenCalledWith([
    {
      entity_type: 'voyage_pol_schedule',
      entity_id: '12::CNSHA',
      field_name: 'atd',
      old_value: null,
      new_value: '2026-07-10',
      changed_by: 'user-1',
      justification: 'ATD documental',
    },
  ])
})

it('preserva a alteração de schedule quando o caller não informa changedBy', async () => {
  const insertMock = vi.fn(async () => ({ error: null }))
  const auditLogs = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) })),
        })),
      })),
    })),
    insert: insertMock,
  }
  fromMock.mockReturnValue(auditLogs)

  await saveVoyagePolSchedule({
    voyageId: 12,
    pol: 'CNSHA',
    etd: '2026-07-08',
    changedBy: null,
  })

  expect(insertMock).toHaveBeenCalledWith([
    expect.objectContaining({ field_name: 'etd', changed_by: null }),
  ])
})

it('hidrata ATB e ETD mais recentes ao listar schedules de POD', async () => {
  const auditLogs = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn(async () => ({
              data: [
                { entity_id: '12::BRSSZ', field_name: 'atb', new_value: '2026-07-10T08:00', changed_at: '2026-07-10T08:00:00Z' },
                { entity_id: '12::BRSSZ', field_name: 'atb', new_value: '2026-07-09T08:00', changed_at: '2026-07-09T08:00:00Z' },
                { entity_id: '12::BRSSZ', field_name: 'etd', new_value: '2026-07-12', changed_at: '2026-07-08T12:00:00Z' },
              ],
              error: null,
            })),
          })),
        })),
      })),
    })),
  }
  fromMock.mockReturnValue(auditLogs)

  const schedules = await listVoyagePodSchedules(['12::BRSSZ'])

  expect(schedules.get('12::BRSSZ')).toMatchObject({
    atb: '2026-07-10T08:00',
    etd: '2026-07-12',
  })
})

it('grava audit rows de ATB e ETD por POD', async () => {
  const insertMock = vi.fn(async () => ({ error: null }))
  let selectCalls = 0
  const auditLogs = {
    select: vi.fn(() => {
      selectCalls += 1
      if (selectCalls === 1) {
        return {
          eq: vi.fn(() => ({
            in: vi.fn(() => ({
              order: vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) })),
            })),
          })),
        }
      }
      return {
        eq: vi.fn(() => ({
          order: vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) })),
        })),
      }
    }),
    insert: insertMock,
  }
  fromMock.mockReturnValue(auditLogs)

  await saveVoyagePodSchedule({
    voyageId: 12,
    pod: 'BRSSZ',
    eta: null,
    etb: null,
    ata: null,
    atb: '2026-07-10T08:00',
    etd: '2026-07-12',
    atd: null,
    rtw: null,
    ceStatus: null,
    linked: null,
    changedBy: 'user-1',
  })

  expect(insertMock).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({
      field_name: 'atb',
      new_value: '2026-07-10T08:00',
      justification: 'Atualizacao manual de ATB por POD',
    }),
    expect.objectContaining({
      field_name: 'etd',
      new_value: '2026-07-12',
      justification: 'Atualizacao manual de ETD por POD',
    }),
  ]))
})
