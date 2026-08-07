import { describe, expect, it } from 'vitest'
import {
  isEscalaOmitted,
  mapClosedReportToSlaRow,
  summarizeAgencyReportSlaByDepartment,
  type ClosedAgencyReportListItem,
} from '../agencyReportSla'
import type { VoyageEscalaSchedule } from '../voyageRouteSchedules'

function closedReport(overrides: Partial<ClosedAgencyReportListItem> = {}): ClosedAgencyReportListItem {
  return {
    voyage_id: 1,
    port: 'BRVIX',
    closed_at: '2026-02-10T12:00:00.000Z',
    closed_by: 'user-1',
    voyage: { voyage_number: 'V001', vessel: { name: 'NAVIO TESTE' } },
    closed_snapshot: {
      header: { unifiedAtd: '2026-02-02', deadlineDate: '2026-02-05' },
      departmentSignoffs: [
        { department: 'operacoes', signed_by: 'user-a', signed_at: '2026-02-04T10:00:00.000Z' },
        { department: 'documentacao', signed_by: 'user-b', signed_at: '2026-02-09T10:00:00.000Z' },
        { department: 'equipamentos', signed_by: 'user-c', signed_at: '2026-02-05T10:00:00.000Z' },
      ],
    },
    ...overrides,
  }
}

describe('mapClosedReportToSlaRow', () => {
  it('mapeia uma linha no prazo (assinatura antes ou no dia do prazo)', () => {
    const row = mapClosedReportToSlaRow(closedReport())
    expect(row).not.toBeNull()
    const operacoes = row!.departments.find((d) => d.department === 'operacoes')!
    expect(operacoes.state).toBe('on-time')
    expect(operacoes.businessDaysElapsed).toBe(2) // 2026-02-02 (seg) -> 2026-02-04 (qua)
  })

  it('mapeia uma linha atrasada (assinatura depois do prazo)', () => {
    const row = mapClosedReportToSlaRow(closedReport())
    const documentacao = row!.departments.find((d) => d.department === 'documentacao')!
    expect(documentacao.state).toBe('overdue')
  })

  it('exclui linhas com snapshot legado (sem header.unifiedAtd/deadlineDate — antes da vigência)', () => {
    const legacy = closedReport({
      closed_snapshot: { header: { unifiedAtd: null, deadlineDate: null }, departmentSignoffs: [] },
    })
    expect(mapClosedReportToSlaRow(legacy)).toBeNull()

    const missingHeader = closedReport({ closed_snapshot: {} })
    expect(mapClosedReportToSlaRow(missingHeader)).toBeNull()
  })

  it('exclui linhas sem closed_at (defensivo)', () => {
    expect(mapClosedReportToSlaRow(closedReport({ closed_at: null }))).toBeNull()
  })

  it('calcula o tempo total decorrido (dias corridos) do ATD ao Fechamento', () => {
    const row = mapClosedReportToSlaRow(closedReport())!
    expect(row.elapsedCalendarDaysToClosure).toBe(8) // 2026-02-02 -> 2026-02-10
  })
})

describe('isEscalaOmitted', () => {
  function escala(overrides: Partial<VoyageEscalaSchedule> = {}): VoyageEscalaSchedule {
    return {
      entityId: '1::BRVIX',
      voyageId: 1,
      port: 'BRVIX',
      eta: null, etb: null, ata: null, atb: null, etd: null, atd: null, rtw: null,
      ceStatus: null, podCeStatus: null, exportCeStatus: null, linked: null, escalaNumber: null,
      omitted: false, deleted: false, temImportacao: true, temExportacao: false, temGranito: false,
      containersQty: null, movementsQty: null, dischargePorts: [], divergences: [],
      ...overrides,
    }
  }

  it('retorna true quando a escala vigente está marcada como omitida', () => {
    const map = new Map([[1, [escala({ omitted: true })]]])
    expect(isEscalaOmitted(map, 1, 'BRVIX')).toBe(true)
  })

  it('retorna false quando a escala vigente não está omitida', () => {
    const map = new Map([[1, [escala({ omitted: false })]]])
    expect(isEscalaOmitted(map, 1, 'BRVIX')).toBe(false)
  })

  it('retorna false quando a escala não é encontrada na projeção viva (não exclui por precaução)', () => {
    const map = new Map<number, VoyageEscalaSchedule[]>()
    expect(isEscalaOmitted(map, 1, 'BRVIX')).toBe(false)
  })
})

describe('summarizeAgencyReportSlaByDepartment', () => {
  it('soma cumprimento por DEPARTAMENTO, nunca por usuário/pessoa', () => {
    const rowOnTime = mapClosedReportToSlaRow(closedReport())!
    const rowOverdue = mapClosedReportToSlaRow(
      closedReport({
        voyage_id: 2,
        port: 'BRSSZ',
        closed_snapshot: {
          header: { unifiedAtd: '2026-02-02', deadlineDate: '2026-02-05' },
          departmentSignoffs: [
            { department: 'operacoes', signed_by: 'user-x', signed_at: '2026-02-09T10:00:00.000Z' },
            { department: 'documentacao', signed_by: 'user-y', signed_at: '2026-02-09T10:00:00.000Z' },
            { department: 'equipamentos', signed_by: 'user-z', signed_at: '2026-02-09T10:00:00.000Z' },
          ],
        },
      }),
    )!

    const summary = summarizeAgencyReportSlaByDepartment([rowOnTime, rowOverdue])
    const operacoes = summary.find((s) => s.department === 'operacoes')!
    expect(operacoes.onTime).toBe(1)
    expect(operacoes.overdue).toBe(1)
    expect(operacoes.total).toBe(2)
    expect(operacoes.rate).toBe(0.5)

    // nenhum campo/chave de agregação por signed_by/usuário deve existir no resultado.
    for (const entry of summary) {
      expect(Object.keys(entry)).not.toContain('signed_by')
      expect(Object.keys(entry)).not.toContain('user')
    }
  })

  it('retorna rate null quando não há linhas para o período', () => {
    const summary = summarizeAgencyReportSlaByDepartment([])
    expect(summary.every((s) => s.total === 0 && s.rate === null)).toBe(true)
  })
})
